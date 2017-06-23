import * as util from 'util';
import * as _ from 'lodash';
import * as builder from 'botbuilder';
import * as request from 'request';
import ApplicationInsights = require("applicationinsights");
import Events from './events';

export interface ISentimentSettings {
  minWords?: number,
  url?: string,
  id?: string,
  key?: string
}

export interface IInstrumentationSettings {
  instrumentationKey?: string | string[];
  sentiments?: ISentimentSettings;
  autoLogOptions?: IAutoLogOptions;
}

export interface IAutoLogOptions {
  autoCollectConsole?: boolean;
  autoCollectExceptions?: boolean;
  autoCollectRequests?: boolean;
  autoCollectPerf?: boolean;
}

const CURRENT_BOT_NAME = "currentBotName";
const DefaultBotName = "*"
/**
 * Sets the name for the Bot of the current Dialog
 * @param session
 * @param botName
 */
export function setCurrentBotName(session: any, botName: string): any {
  session.privateConversationData[CURRENT_BOT_NAME] = botName;
  return session;
}

export class BotFrameworkInstrumentation {

  private appInsightsClient: typeof ApplicationInsights.client;
  private currentBotName: string = DefaultBotName;

  private console = {};
  private methods = {
    "debug": 0,
    "info": 1,
    "log": 2,
    "warn": 3,
    "error": 4
  };
  private customFields: {
    containerKeys: { [key: number]: string[]; },
    containers: { [key: number]: Object },
    objects: { [key: number]: Object }
  } = {
    containerKeys: {},
    containers: {},
    objects: {}
  }
  private instrumentationKey: string;
  private sentiments: ISentimentSettings = {
    minWords: 3,
    url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
    id: 'bot-analytics',
    key: null
  };

  constructor(public settings: IInstrumentationSettings) {

    settings = settings || null;
    _.extend(this.sentiments, settings.sentiments);

    this.sentiments.key = (this.sentiments.hasOwnProperty('key')) ? this.sentiments.key : process.env.CG_SENTIMENT_KEY;
    this.instrumentationKey = settings.instrumentationKey || process.env.APPINSIGHTS_INSTRUMENTATIONKEY

    if (!this.instrumentationKey) {
      throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
    }

    if (!this.sentiments.key) {
      console.warn('No sentiment key was provided - text sentiments will not be collected');
    }
  }

  private formatArgs(args: any[]) {
    return util.format.apply(util.format, Array.prototype.slice.call(args));
  }

  private setupConsoleCollection() {

    // Overriding console methods so that prints to console will first be logged
    // to application insights
    _.keys(this.methods).forEach(method => {

      console[method] = (() => {
        let original = console.log;

        return (...args) => {

          let stdout: any;
          try {

            let msg = this.formatArgs(args);
            this.trackTrace(msg, this.methods[method]);

            stdout = process.stdout;
            process.stdout = process.stderr;
            original.apply(console, args);
          } finally {
            process.stdout = stdout || process.stdout;
          }
        };
      })();
    });
  }

  private collectSentiment(session: any, text: string) {

    if (!this.sentiments.key) return;
    if (text.match(/\S+/g).length < this.sentiments.minWords) return;

    // let message = session.message || {};
    // let timestamp = message.timestamp;
    // let address = message.address || {};
    // let conversation = address.conversation || {};
    // let user = address.user || {};
    let message: builder.IMessage = session.message;
    let timestamp: string = message.timestamp;
    let address: builder.IAddress = message.address || null;
    let conversation: builder.IIdentity = address.conversation || null;
    let user: builder.IIdentity = address.user || null;

    request({
      url: this.sentiments.url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': this.sentiments.key
      },
      json: true,
      body: {
        "documents": [
          {
            "language": "en",
            "id": this.sentiments.id,
            "text": text
          }
        ]
      }
    },
      (error, response, body) => {

        if (error) {
          return this.trackException(error);
        }

        try {
          let result: any = _.find(body.documents, { id: this.sentiments.id }) || {};
          var score = result.score || null;

          if (isNaN(score)) {
            throw new Error('Could not collect sentiment');
          }

          var item = {
            text: text,
            score: score,
            timestamp: timestamp,
            channel: address.channelId,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
          };

          this.trackEvent(Events.Sentiment.name, item);
        } catch (error) {
          return this.trackException(error);
        }
      });
  }

  /**
   *
   * @param props
   * @param customFields
   */
  private updateProps(props: any, customFields?: any): { [key: string]: string; } {
    if (!customFields) {
      customFields = {};
      for (var key in this.customFields.objects) {
        _.extend(customFields, this.customFields.objects[key]);
      }
      for (var key in this.customFields.containerKeys) {
        if (this.customFields.containerKeys.hasOwnProperty(key)) {
          let container = this.customFields.containers[key];
          let values = this.customFields.containerKeys[key]
          for (let key of values) {
            customFields[key] = (container.hasOwnProperty(key)) ? container[key] : `VALUE-FOR-KEY:'${key}'-NOT-FOUND`
          }
        }
      }
    }
    _.extend(props, customFields);
    return props;
  }

  private getBotName(session: builder.Session): string {
    let name: string = (session.privateConversationData.hasOwnProperty(CURRENT_BOT_NAME)) ? session.privateConversationData[CURRENT_BOT_NAME] : DefaultBotName
    if (name === DefaultBotName && session.library) {
      name = (session.library.hasOwnProperty("name")) ? session.library.name : DefaultBotName
    }
    return name;
  }

  private prepProps(session: builder.Session): { [key: string]: string; } {
    let message: builder.IMessage = session.message;
    let address: builder.IAddress = message.address || null;
    let conversation: builder.IIdentity = address.conversation || null;
    let user: builder.IIdentity = address.user || null;
    this.currentBotName = this.getBotName(session);
    let item = {
      text: message.text,
      type: message.type,
      timestamp: message.timestamp,
      conversationId: conversation.id,
      channel: address.channelId,
      userId: user.id,
      userName: user.name,
      locale: session.preferredLocale(),
      botName: this.currentBotName
    };

    console.log("\nBOTNAME: ", item.botName, "\n")
    return this.updateProps(item)
  }

  private setupInstrumentation(autoCollectConsole: boolean = false, autoCollectExceptions: boolean = false, autoCollectRequests: boolean = false, autoCollectPerf: boolean = false) {
    //we are setting the automatic updates to the first instumentation key.
    // console.log("INSTRUMENTATION KEY: ", this.instrumentationKey)

    ApplicationInsights.setup(this.instrumentationKey)
      .setAutoCollectConsole(autoCollectConsole)
      .setAutoCollectExceptions(autoCollectExceptions)
      .setAutoCollectRequests(autoCollectRequests)
      .setAutoCollectPerformance(autoCollectPerf)
      .start();

    this.appInsightsClient = ApplicationInsights.getClient(this.instrumentationKey);
  }

  monitor(bot: builder.UniversalBot) {
    this.setupInstrumentation(
      this.settings.autoLogOptions.autoCollectConsole,
      this.settings.autoLogOptions.autoCollectExceptions,
      this.settings.autoLogOptions.autoCollectRequests,
      this.settings.autoLogOptions.autoCollectPerf
    );

    // Adding middleware to intercept all user messages
    if (bot) {
      this.currentBotName = bot.name;
      bot.use({
        botbuilder: (session: builder.Session, next: any) => {
          try {
            let item = this.prepProps(session)
            this.trackEvent(Events.UserMessage.name, item);
            self.collectSentiment(session, session.message.text);
          } catch (e) {
          }
          finally {
            next();
          }
        },
        send: (message: builder.IMessage, next: (err?: Error) => void) => {
          try {
            let address: builder.IAddress = message.address || null;
            let conversation: builder.IIdentity = address.conversation || null;
            let user: builder.IIdentity = address.user || null;
            let item = {
              text: message.text,
              type: message.type,
              timestamp: message.timestamp,
              conversationId: conversation.id,
              botName: this.currentBotName
            };

            this.updateProps(item)
            this.trackEvent(Events.BotMessage.name, item);
          } catch (e) {
          }
          finally {
            next();
          }
        }
      });
    }

    // Collect intents collected from LUIS after entities were resolved
    let self = this;
    builder.IntentDialog.prototype.recognize = (() => {
      let _recognize = builder.IntentDialog.prototype.recognize;
      return function (session: builder.IRecognizeContext, cb) {

        let _dialog = this;
        _recognize.apply(_dialog, [session, (err, result) => {

          let message: builder.IMessage = session.message;
          let address: builder.IAddress = message.address || null;
          let conversation: builder.IIdentity = address.conversation || null;
          let user: builder.IIdentity = address.user || null;

          let item: any = {
            text: message.text,
            timestamp: message.timestamp,
            intent: result && result.intent,
            channel: address.channelId,
            score: result && result.score,
            withError: !err,
            error: err,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
          };

          //there is no point sending 0 score intents to the telemetry.
          if (item.score > 0) {
            self.trackEvent(Events.Intent.name, item);
          }

          // Tracking entities for the event
          if (result && result.entities) {
            result.entities.forEach(value => {
              let entityItem = _.clone(item);
              entityItem.entityType = value.type;
              entityItem.entityValue = value.entity
              self.trackEvent(Events.Entity.name, entityItem);
            });
          }

          // Todo: on "set alarm" utterence, failiure
          return cb(err, result);
        }]);
      };
    })();
  }

  /**
   *Allows you to set custom fields that will be logged with every log statement
   * @param objectContainer  Reference to Object that contains fields that need to be logged
   * @param keys             Optional array of key properties on objectContainer
   */
  setCustomFields(objectContainer: Object, keys?: string | string[]) {
    if (keys) {
      let index = (<any>Object).values(this.customFields.containers).indexOf(objectContainer)
      let keyValues: string[] = Array.isArray(keys) ? keys : [keys];
      if (index == -1) {
        let idx = (Object.keys(this.customFields.containers).length - 1) <= -1 ? 0 : Object.keys(this.customFields.containers).length - 1;
        this.customFields.containers[idx] = objectContainer;
        this.customFields.containerKeys[idx] = keyValues;
      } else {
        for (let key of keyValues) {
          if (!this.customFields.containerKeys[index].includes(key)) {
            this.customFields.containerKeys[index].push(key)
          }
        }
      }
    } else {
      let index = (<any>Object).values(this.customFields.objects).indexOf(objectContainer)
      if (index == -1) {
        let idx = (Object.keys(this.customFields.objects).length - 1) <= -1 ? 0 : Object.keys(this.customFields.objects).length - 1;
        this.customFields.objects[idx] = objectContainer;
      }
    }
  }

  startTransaction(session: builder.Session, name = '') {
    let message: builder.IMessage = session.message;
    let address: builder.IAddress = message.address || null;
    let conversation: builder.IIdentity = address.conversation || null;
    let user: builder.IIdentity = address.user || null;

    let item = {
      name: name,
      timestamp: message.timestamp,
      channel: address.channelId,
      conversationId: conversation.id,
      userId: user.id,
      userName: user.name
    };

    this.trackEvent(Events.StartTransaction.name, item);
  }

  endTransaction(session: builder.Session, name = '', successful = true) {
    let message: builder.IMessage = session.message;
    let address: builder.IAddress = message.address || null;
    let conversation: builder.IIdentity = address.conversation || null;
    let user: builder.IIdentity = address.user || null;

    let item = {
      name: name,
      successful: successful.toString(),
      timestamp: message.timestamp,
      channel: address.channelId,
      conversationId: conversation.id,
      userId: user.id,
      userName: user.name
    };

    this.trackEvent(Events.EndTransaction.name, item);
  }

  private prepareLogData(session: builder.Session, item: { [key: string]: string }): { [key: string]: string } {
    let props = this.prepProps(session)
    props = this.updateProps(props, item);
    return props;
  }

  /**
   * Log custom Events
   * @param eventName         Name of the Log event
   * @param session           BotFramework Session object
   * @param properties        Custom Properties that need to be logged
   */
  public logCustomEvent(eventName: string, session: builder.Session, properties?: { [key: string]: string }) {
    properties["eventName"] = eventName
    this.trackEvent(Events.CustomEvent.name, this.prepareLogData(session, properties));
  }

  /**
   * Log custom Errors
   * @param error       Error needing logged
   * @param session     BotFramework Session object
   * @param properties  Custom Properties that need to be logged
   */
  public logCustomError(error: Error, session: builder.Session, properties?: {
    [key: string]: string
  }) {
    this.trackException(error, this.prepareLogData(session, properties));
  }

  /**
   * Logs QNA maker service data
   * @param session
   * @param userQuery
   * @param kbQuestion
   * @param kbAnswer
   * @param score
   */
  public logQNAEvent(userQuery: string, session: builder.Session, kbQuestion: string, kbAnswer: string, score: any) {
    let message: builder.IMessage = session.message;
    let address: builder.IAddress = message.address || null;
    let conversation: builder.IIdentity = address.conversation || null;
    let user: builder.IIdentity = address.user || null;

    let item: { [key: string]: string; } = {
      score: score,
      timestamp: message.timestamp,
      channel: address.channelId,
      conversationId: conversation.id,
      userId: user.id,
      userName: user.name,
      userQuery: userQuery,
      kbQuestion: kbQuestion,
      kbAnswer: kbAnswer
    };
    // let props = this.prepProps(session)
    item = this.updateProps(item);
    this.trackEvent(Events.QnaEvent.name, this.prepareLogData(session, item));
  }

  /**
   * Log a user action or other occurrence.
   * @param name              A string to identify this event in the portal.
   * @param properties        map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   * @param measurements      map[string, number] - metrics associated with this event, displayed in Metrics Explorer on the portal. Defaults to empty.
   * @param tagOverrides      the context tags to use for this telemetry which overwrite default context values
   * @param contextObjects    map[string, contextObject] - An event-specific context that will be passed to telemetry processors handling this event before it is sent. For a context spanning your entire operation, consider appInsights.getCorrelationContext
   */
  private trackEvent(
    name: string,
    properties?: { [key: string]: string; },
    measurements?: { [key: string]: number; },
    tagOverrides?: { [key: string]: string; },
    contextObjects?: { [name: string]: any; }): void {
    console.log("\nTRACK EVENT -------\nCLIENT: ", this.instrumentationKey, "\nEVENT: ", name, "\nPROPS: ", JSON.stringify(properties, null, 2), "\nTRACK EVENT -------\n")
    this.appInsightsClient.trackEvent(name, properties, measurements, tagOverrides, contextObjects);
  }

  /**
   * Log a trace message
   * @param message        A string to identify this event in the portal.
   * @param properties     map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   * @param tagOverrides   the context tags to use for this telemetry which overwrite default context values
   * @param contextObjects map[string, contextObject] - An event-specific context that will be passed to telemetry processors handling this event before it is sent. For a context spanning your entire operation, consider appInsights.getCorrelationContext
   */
  private trackTrace(
    message: string,
    severityLevel?: any,
    properties?: { [key: string]: string; },
    tagOverrides?: { [key: string]: string; },
    contextObjects?: { [name: string]: any; }): void {
    console.log("\nTRACK TRACE -------\nCLIENT: ", this.instrumentationKey, "\nEVENT: ", message, "\nSEC-LEVEL: ", severityLevel, "\nPROPS: ", JSON.stringify(properties, null, 2), "\nTRACK TRACE -------\n")
    this.appInsightsClient.trackTrace(message, severityLevel, properties, tagOverrides, contextObjects);
  }

  /**
   * Log an exception you have caught.
   * @param   exception   An Error from a catch clause, or the string error message.
   * @param   properties  map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   * @param   measurements    map[string, number] - metrics associated with this event, displayed in Metrics Explorer on the portal. Defaults to empty.
   * @param   tagOverrides the context tags to use for this telemetry which overwrite default context values
   * @param   contextObjects        map[string, contextObject] - An event-specific context that will be passed to telemetry processors handling this event before it is sent. For a context spanning your entire operation, consider appInsights.getCorrelationContext
   */
  private trackException(
    exception: Error,
    properties?: { [key: string]: string; },
    measurements?: { [key: string]: number; },
    tagOverrides?: { [key: string]: string; },
    contextObjects?: { [name: string]: any; }): void {
    console.log("\nTRACK EXCEPTION -------\nCLIENT: ", this.instrumentationKey, "\nEVENT: ", exception, "\nEXCEPTION: ", exception, "\nPROPS: ", JSON.stringify(properties, null, 2), "\nTRACK EXCEPTION -------\n")
    this.appInsightsClient.trackException(exception, properties, measurements, tagOverrides, contextObjects);
  }
}