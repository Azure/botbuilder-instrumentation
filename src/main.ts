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

  private instrumentationKeys: string[] = [];
  private sentiments: ISentimentSettings = {};

  constructor(settings?: IInstrumentationSettings) {
    this.initSentimentData();
    settings = settings || {};
    _.extend(this.sentiments, settings.sentiments);

    this.sentiments.key = this.sentiments.key || process.env.CG_SENTIMENT_KEY;

    if (settings.instrumentationKey) {

      this.instrumentationKeys = 
          Array.isArray(settings.instrumentationKey) ?
          settings.instrumentationKey : 
          [ settings.instrumentationKey ];
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

    text = text || '';

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
    if (this.instrumentationKeys && this.instrumentationKeys.length > 0) {
      //we are setting the automatic updates to the first instumentation key.
      ApplicationInsights.setup(this.instrumentationKeys[0])
        .setAutoCollectConsole(true)
        .setAutoCollectExceptions(true)
        .setAutoCollectRequests(true)
        .start();

      //for all other custom events, traces etc, we are initiazling application insight clients accordignly.
      _.forEach(this.instrumentationKeys, (iKey) => {
        let client = ApplicationInsights.getClient(iKey);
        this.appInsightsClients.push(client);
      });
    }
  }

  monitor (bot: builder.UniversalBot) {

    this.setupInstrumentation();

    // Adding middleware to intercept all user messages
    if (bot) {
      bot.use({
        botbuilder: (session, next) => {

          try {
            let message: any = session.message;
            let address = message.address || {};
            let conversation = address.conversation || {};
            let user = address.user || {};

            let item =  { 
              text: message.text,
              type: message.type,
              timestamp: message.timestamp,
              conversationId: conversation.id,
              channel: address.channelId,
              userId: user.id,
              userName: user.name
            };
            
            this.trackEvent(Events.UserMessage.name, item);
            self.collectSentiment(session, message.text);
          } catch (e) { 
          } finally {
              next();
          }
        },
        send: (message: any, next: (err?: Error) => void) => {
          try {
            if(message.type == "message"){
              let address = message.address || {};
              let conversation = address.conversation || {};
              let user = address.user || {};  

              let item =  { 
                text: message.text,
                type: message.type,
                timestamp: message.timestamp,
                conversationId: conversation.id,
                userId: user.id,
                userName: user.name
              };

              this.trackEvent(Events.BotMessage.name, item);
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
      return function(context, cb) {

        let _dialog = this;
        _recognize.apply(_dialog, [context, (err, result) => {

          let message = context.message;
          let address = message.address || {};
          let conversation = address.conversation || {};
          let user = address.user || {};

          let item: any =  { 
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
   * Logs QNA maker service data
   * @param context 
   * @param userQuery 
   * @param kbQuestion 
   * @param kbAnswer 
   * @param score 
   */
  trackQNAEvent(context:any, userQuery:string, kbQuestion:string, kbAnswer:string, score:any) {
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
   * Logs your own event with custom data
   * @param context 
   * @param eventName 
   * @param keyValuePair an object with custom properties
   */
  trackCustomEvent(context, eventName: string, keyValuePair: any) {
    let message = context.message;
    let address = message.address || {};
    let conversation = address.conversation || {};
    let user = address.user || {};
    let item = {
      timestamp: message.timestamp,
      channel: address.channelId,
      conversationId: conversation.id,
      userId: user.id,
      userName: user.name
    };
    //merge the custom properties with the defaults
    let eventData = Object.assign(item, keyValuePair);
    this.trackEvent(eventName, eventData);
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
    properties?: {[key: string]: string;}, 
    measurements?: {[key: string]: number;}, 
    tagOverrides?: {[key: string]: string;}, 
    contextObjects?: {[name: string]: any;}): void   {
    _.forEach(this.appInsightsClients, (client) => {
      client.trackEvent(name, properties);
    });
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
    _.forEach(this.appInsightsClients, (client) => {
      client.trackTrace(message, severityLevel, properties);
    });
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
    _.forEach(this.appInsightsClients, (client) => {
      client.trackException(exception, properties);
    });
  }
}