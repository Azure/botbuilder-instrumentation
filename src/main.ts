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
}

export const CURRENT_BOT_NAME = "currentBotName";

/**
 * Sets the name for the Bot of the current Dialog
 * @param session
 * @param botName
 */
export function loggerSetCurrentBotName(session: any, botName: string): any {
  session.dialogData[CURRENT_BOT_NAME] = botName;
  return session;
}

export class BotFrameworkInstrumentation {

  private appInsightsClient: typeof ApplicationInsights.client;
  private currentBotName: string = "*";

  private console = {};
  private methods = {
    "debug": 0,
    "info": 1,
    "log": 2,
    "warn": 3,
    "error": 4
  };

  private customFields: Object = {};
  private instrumentationKey: string;
  private sentiments: ISentimentSettings = {
    minWords: 3,
    url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
    id: 'bot-analytics',
    key: null
  };

  constructor(settings?: IInstrumentationSettings) {

    settings = settings || {};
    _.extend(this.sentiments, settings.sentiments);

    this.sentiments.key = (this.sentiments) ? this.sentiments.key : process.env.CG_SENTIMENT_KEY;
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

    let message = session.message || {};
    let timestamp = message.timestamp;
    let address = message.address || {};
    let conversation = address.conversation || {};
    let user = address.user || {};

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

  private setupInstrumentation() {
    //we are setting the automatic updates to the first instumentation key.
    // console.log("INSTRUMENTATION KEY: ", this.instrumentationKey)

    ApplicationInsights.setup(this.instrumentationKey)
      .setAutoCollectConsole(true)
      .setAutoCollectExceptions(true)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true)
      .start();

    this.appInsightsClient = ApplicationInsights.getClient(this.instrumentationKey);
  }

  private updateProps(props: any, item: any = this.customFields): { [key: string]: string; } {
    _.extend(props, item);
    return props;
  }

  private prepProps(session: builder.Session): { [key: string]: string; } {
    let message: any = session.message;
    let address = message.address || {};
    let conversation = address.conversation || {};
    let user = address.user || {};
    this.currentBotName = (session.dialogData) ? session.dialogData[CURRENT_BOT_NAME] : (session.library) ? session.library.name : "*";
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

  monitor(bot: builder.UniversalBot) {

    this.setupInstrumentation();

    // Adding middleware to intercept all user messages
    if (bot) {
      this.currentBotName = bot.name;
      bot.use({
        botbuilder: (session, next) => {
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
        send: (message: any, next: (err?: Error) => void) => {
          try {
            let address = message.address || {};
            let conversation = address.conversation || {};
            let user = address.user || {};
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
      return function (context, cb) {

        let _dialog = this;
        _recognize.apply(_dialog, [context, (err, result) => {

          let message = context.message;
          let address = message.address || {};
          let conversation = address.conversation || {};
          let user = address.user || {};

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
   * Allows you to set custom fields that will be logged with every log statement
   * @param fields      Reference to Object that contains fields that need to be logged
   */
  setCustomFields(fields: Object) {
    this.customFields = fields
  }

  startTransaction(context: any, name = '') {

    let message = context.message;
    let address = message.address || {};
    let conversation = address.conversation || {};
    let user = address.user || {};

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

  endTransaction(context: any, name = '', successful = true) {
    let message = context.message;
    let address = message.address || {};
    let conversation = address.conversation || {};
    let user = address.user || {};

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
  /**
   * Log custom Events
   * @param eventName         Name of the Log event
   * @param session           BotFramework Session object
   * @param properties        Custom Properties that need to be logged
   */
  public logCustomEvent(eventName: string, session: builder.Session, properties?: { [key: string]: string }) {
    let props = this.prepProps(session)
    props = this.updateProps(props, properties);
    this.trackEvent(Events.CustomEvent.name, props);
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
    let props = this.prepProps(session)
    props = this.updateProps(props, properties);
    this.trackException(error, props);
  }

  /**
   * Logs QNA maker service data
   * @param context
   * @param userQuery
   * @param kbQuestion
   * @param kbAnswer
   * @param score
   */
  logQNAEvent(context: any, userQuery: string, kbQuestion: string, kbAnswer: string, score: any) {
    let message = context.message;
    let address = message.address || {};
    let conversation = address.conversation || {};
    let user = address.user || {};

    let item = {
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

    this.trackEvent(Events.QnaEvent.name, item);
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