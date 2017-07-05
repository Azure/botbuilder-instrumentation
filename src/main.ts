import * as util from 'util';
import * as _ from 'lodash';
import * as builder from 'botbuilder';
import * as request from 'request';
import ApplicationInsights = require("applicationinsights");
import Events from './events';

export type IDictionary = { [ key: string ]: string;}

export interface ISentimentSettings {
  minWords?: number,
  url?: string,
  id?: string,
  key?: string
}

export interface IAutoLogOptions {
  autoCollectConsole?: boolean;
  autoCollectExceptions?: boolean;
  autoCollectRequests?: boolean;
  autoCollectPerf?: boolean;
}

export interface IInstrumentationSettings {
  instrumentationKey?: string | string[];
  sentiments?: ISentimentSettings;
  omitUserName?: boolean;
  autoLogOptions?: IAutoLogOptions;
  customFields?: ICustomFields;
}

/**
 * This interface is used to pass custom fields to be logged from a session state array
 */
export interface ICustomFields {
  userData?: string[];
  conversationData?: string[];
  privateConversationData?: string[];
  dialogData?: string[];
}

const PROPERTY_BAGS = [ 'userData', 'conversationData', 'privateConversationData', 'dialogData' ];

export class BotFrameworkInstrumentation {

  private appInsightsClients:Array<typeof ApplicationInsights.client> = [];

  private console = {};
  private methods = {
    "debug": 0,
    "info": 1,
    "log": 2,
    "warn": 3,
    "error":4
  };

  /**
   * This is a list of custom fields that will be pushed with the logging of each event
   */
  private customFields: ICustomFields = null;

  private instrumentationKeys: string[] = [];
  private sentiments: ISentimentSettings = {};
  private settings: IInstrumentationSettings = {};

  constructor(settings?: IInstrumentationSettings) {
    this.initSentimentData();
    this.settings = settings || {};
    this.customFields = this.settings.customFields || null;

    _.extend(this.sentiments, this.settings.sentiments);

    this.sentiments.key = this.sentiments.key || process.env.CG_SENTIMENT_KEY;

    if (this.settings.instrumentationKey) {

      this.instrumentationKeys = 
          Array.isArray(this.settings.instrumentationKey) ?
          this.settings.instrumentationKey : 
          [ this.settings.instrumentationKey ];
    } 
    else {
      if (process.env.APPINSIGHTS_INSTRUMENTATIONKEY) {
        this.instrumentationKeys = [process.env.APPINSIGHTS_INSTRUMENTATIONKEY];
      }
    }

    if (!this.instrumentationKeys) {
      throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
    }

    if (!this.sentiments.key) {
      console.warn('No sentiment key was provided - text sentiments will not be collected');
    }

    this.appInsightsClients = [];
  }

  private initSentimentData() {
    this.sentiments = {
      minWords: 3,
      url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
      id: 'bot-analytics',
      key: null
    };
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

          let stdout = null;
          try {
            
            let msg = this.formatArgs(args);
            this.logTrace(null, msg, this.methods[method]);

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

    text = text || '';

    if (!this.sentiments.key) return;
    if (text.match(/\S+/g).length < this.sentiments.minWords) return;
    
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
        return this.logException(session, error);
      }

      try {
        let result: any = _.find(body.documents, { id: this.sentiments.id }) || {};
        var score = result.score || null;

        if (isNaN(score)) {
          throw new Error('Could not collect sentiment');
        }

        var item = { text: text, score: score };

        this.logEvent(session, Events.Sentiment.name, item);
      } catch (error) {
        return this.logException(session, error);
      }
    });
  }

  private setupInstrumentation() {
    if (this.instrumentationKeys && this.instrumentationKeys.length > 0) {
      //we are setting the automatic updates to the first instumentation key.
      let autoCollectOptions = this.settings && this.settings.autoLogOptions || {};
      ApplicationInsights.setup(this.instrumentationKeys[0])
        .setAutoCollectConsole(autoCollectOptions.autoCollectConsole || false)
        .setAutoCollectExceptions(autoCollectOptions.autoCollectExceptions || false)
        .setAutoCollectRequests(autoCollectOptions.autoCollectRequests || false)
        .setAutoCollectPerformance(autoCollectOptions.autoCollectPerf || false)
        .start();

      //for all other custom events, traces etc, we are initiazling application insight clients accordignly.
      let self = this;
      _.forEach(this.instrumentationKeys, (iKey) => {
        let client = ApplicationInsights.getClient(iKey);
        self.appInsightsClients.push(client);
      });
    }
  }

  monitor (bot: builder.UniversalBot) {

    this.setupInstrumentation();

    // Adding middleware to intercept all user messages
    if (bot) {
      bot.use({
        botbuilder: (session: builder.Session, next: Function) => {

          try {
            let message: any = session.message;

            let item =  { 
              text: message.text,
              type: message.type
            };
            
            this.logEvent(session, Events.UserMessage.name, item);
            self.collectSentiment(session, message.text);
          } catch (e) { 
          } finally {
              next();
          }
        },
        send: (message: any, next: (err?: Error) => void) => {
          try {
            if(message.type == "message") {

              let item =  { 
                text: message.text,
                type: message.type
              };

              this.logEvent(message, Events.BotMessage.name, item);
            }
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
      return function(session, cb) {

        let _dialog = this;
        _recognize.apply(_dialog, [session, (err, result) => {

          let message = session.message;

          let item: any =  { 
            text: message.text,
            intent: result && result.intent, 
            score: result && result.score,
            withError: !err,
            error: err
          };
          
          //there is no point sending 0 score intents to the telemetry.
          if (item.score > 0) {
            self.logEvent(session, Events.Intent.name, item);
          }

          // Tracking entities for the event
          if (result && result.entities) {
            result.entities.forEach(value => {

              let entityItem = _.clone(item);
              entityItem.entityType = value.type;
              entityItem.entityValue = value.entity
              self.logEvent(session, Events.Entity.name, entityItem);

            });
          }

          // Todo: on "set alarm" utterence, failiure
          return cb(err, result);
        }]);          
      };
    })();  
  }

  startTransaction(session: builder.Session, name = '') {

    let item = {
      name: name
    };

    this.logEvent(session, Events.StartTransaction.name, item);
  }

  endTransaction(session: builder.Session, name = '', successful = true) {

    let item = {
      name: name,
      successful: successful.toString()
    };

    this.logEvent(session, Events.EndTransaction.name, item);
  }

  /**
   * Logs QNA maker service data
   * @param context 
   * @param userQuery 
   * @param kbQuestion 
   * @param kbAnswer 
   * @param score 
   */
  trackQNAEvent(session: builder.Session, userQuery:string, kbQuestion:string, kbAnswer:string, score:any) {

    let item = {
      score: score,
      userQuery: userQuery,
      kbQuestion: kbQuestion,
      kbAnswer: kbAnswer
    };

    this.logEvent(session, Events.QnaEvent.name, item);
  }

  trackCustomEvent(session: builder.Session, eventName: string, customProperties: IDictionary) {
    this.logEvent(session, eventName, customProperties);
  }

  private getLogProperties(session: builder.Session | builder.IMessage, properties?: IDictionary): any {

    if (session == null) { return properties || null; }

    let message: builder.IMessage | any = {};
    let isSession = false;

    if ((<any>session).message) {
      isSession = true;
      message = (<any>session).message;
    } else {
      message = session;
    }

    let address: builder.IAddress | any = message.address || {};
    let conversation: builder.IIdentity = address.conversation || {};
    let user: builder.IIdentity = address.user || {};
    let item: any = {
      timestamp: message.timestamp,
      channel: address.channelId,
      conversationId: conversation.id,
      userId: user.id
    };

    if (!this.settings.omitUserName) {
      item.userName = user.name;
    }

    // Adding custom fields if present
    if (isSession && this.customFields) {
      PROPERTY_BAGS.forEach(propertyBag => {
        let properties = this.customFields[propertyBag] || [];
        properties.forEach(property => {
          item[property] = session[propertyBag][property] || null;
        });
      });
    }

    return Object.assign(item, properties);
  }

  /**
   * Log a user action or other occurrence.
   * @param name              A string to identify this event in the portal.
   * @param properties        map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   */
  private logEvent(session: builder.Session, name: string, properties?: IDictionary): void   {
    this.appInsightsClients.forEach(client => client.trackEvent(name, this.getLogProperties(session, properties)));
  }

  /**
   * Log a trace message
   * @param message        A string to identify this event in the portal.
   * @param properties     map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   */
  private logTrace(session: builder.Session, message: string, severityLevel: any, properties?: IDictionary) {
    this.appInsightsClients.forEach(client => client.trackTrace(message, severityLevel, this.getLogProperties(session, properties)));
  }

  /**
   * Log an exception you have caught.
   * @param   exception   An Error from a catch clause, or the string error message.
   * @param   properties  map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   */
  private logException(session: builder.Session, exception: Error, properties?: IDictionary) {
    this.appInsightsClients.forEach(client => client.trackException(exception, this.getLogProperties(session, properties)));
  }
}