import * as util from 'util';
import * as _ from 'lodash';
import * as builder from 'botbuilder';
import * as ai from 'botbuilder-ai';
import * as core from 'botbuilder-core';
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
interface ICustomField {
  store: core.BotState
  properties: [string | [string]]
}
export interface ICustomFields extends Array<ICustomField> {}

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
  
  private collectSentiment(context: core.TurnContext, text: string) {

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
        return this.logException(context, error);
      }

      try {
        let result: any = _.find(body.documents, { id: this.sentiments.id }) || {};
        var score = result.score || null;

        if (isNaN(score)) {
          throw new Error('Could not collect sentiment');
        }

        var item = { text: text, score: score };

        this.logEvent(context, Events.Sentiment.name, item);
      } catch (error) {
        return this.logException(context, error);
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
      this.appInsightsClients = [];
      let self = this;
      _.forEach(this.instrumentationKeys, (iKey) => {
        let client = ApplicationInsights.getClient(iKey);
        self.appInsightsClients.push(client);
      });
    }
  }

  monitor (adapter: builder.BotFrameworkAdapter) {

    this.setupInstrumentation();

    // Adding middleware to intercept all user messages
    if (adapter) {
      adapter.use({
        onTurn: async (context: core.TurnContext, next: () => Promise<any>) => {
          context.onSendActivities(this.onOutboundActivities.bind(this))
          context.onUpdateActivity((c, a, n) => this.onOutboundActivities(c, [a], n))

          // Let bot process activity first, so when logging event we have state
          // stores loaded
          await next();

          // User message
          if (context.activity.type == core.ActivityTypes.Message) {
            const activity = context.activity;
            
            const item = {
              text: activity.text,
              type: activity.type
            };

            this.logEvent(context, Events.UserMessage.name, item);
            // this could potentially become async
            this.collectSentiment(context, activity.text);
          }
        }
      });
    }
  }

  private async onOutboundActivities(context: core.TurnContext,
                               activities: Partial<core.Activity>[],
                               next: () => Promise<any>) {
    // Deliver activities
    await next();

    await Promise.all(activities.map(async (activity) => {

      // Bot message
      if(activity.type == "message") {

        const item = {
          text: activity.text,
          type: activity.type
        };

        await this.logEvent(context, Events.BotMessage.name, item);
      }

      // LUIS recognizer trace
      else if ((activity.type == core.ActivityTypes.Trace) &&
               (activity.name == 'LuisRecognizer') ){

        // Collect intents collected from LUIS after entities were resolved
        const recognizerResult = activity.value.recognizerResult

        const topIntent = ai.LuisRecognizer.topIntent(recognizerResult);
        const result = topIntent !== 'None' ? recognizerResult.intents[topIntent] : null;

        let item: any = {
          text: context.activity.text,
          intent: topIntent,
          score: result && result.score,
        };

        //there is no point sending 0 score intents to the telemetry.
        if (item.score > 0) {
          this.logEvent(context, Events.Intent.name, item);
        }

        // Tracking entities for the event
        if (result && result.entities) {
          result.entities.forEach(value => {

            let entityItem = _.clone(item);
            entityItem.entityType = value.type;
            entityItem.entityValue = value.entity
            this.logEvent(context, Events.Entity.name, entityItem);

          });
        }
      }
    }))
  }

  startTransaction(context: core.TurnContext, name = '') {

    let item = {
      name: name
    };

    this.logEvent(context, Events.StartTransaction.name, item);
  }

  endTransaction(context: core.TurnContext, name = '', successful = true) {

    let item = {
      name: name,
      successful: successful.toString()
    };

    this.logEvent(context, Events.EndTransaction.name, item);
  }

  /**
   * Logs QNA maker service data
   */
  trackQNAEvent(context: core.TurnContext, userQuery:string, kbQuestion:string, kbAnswer:string, score:any) {

    let item = {
      score: score,
      userQuery: userQuery,
      kbQuestion: kbQuestion,
      kbAnswer: kbAnswer
    };

    this.logEvent(context, Events.QnaEvent.name, item);
  }

  trackCustomEvent(eventName: string, customProperties: IDictionary, context: builder.TurnContext = null) {
    const logEventName = eventName || Events.CustomEvent.name;
    this.logEvent(context, logEventName, customProperties);
  }

  trackEvent(customProperties: IDictionary, context: core.TurnContext = null) {
    this.trackCustomEvent(null, customProperties, context);
  }

  trackGoalTriggeredEvent(goalName:string, customProperties: IDictionary, context: core.TurnContext) {
    customProperties = customProperties || {};
    customProperties['GoalName'] = goalName;
    this.logEvent(context, Events.GoalTriggeredEvent.name, customProperties);
  }
  
  private getLogProperties(context: core.TurnContext, properties?: IDictionary): any {

    if (context == null) { return properties || null; }

    const activity = context.activity
    const user = activity.from.role === 'user' ? activity.from : activity.recipient

    let item: any = {
      timestamp: activity.timestamp,
      channel: activity.channelId,
      conversationId: activity.conversation.id,
      userId: user.id
    };

    if (!this.settings.omitUserName) {
      item.userName = user.name;
    }


    // Adding custom fields if supplied in the constructor settings
    if (this.customFields) {
      this.customFields.forEach(({ store, properties = []}) => {
        let state = store.get(context)
        properties.forEach(property => {
          if (Array.isArray(property)) {
            item[property[property.length-1]] = _.get(state, property, null);
          }
          else item[property] = state[property] || null;
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
  private logEvent(context: core.TurnContext, name: string, properties?: IDictionary): void   {
    let logProperties =  this.getLogProperties(context, properties);
    this.appInsightsClients.forEach(client => client.trackEvent(name, logProperties));
  }

  /**
   * Log a trace message
   * @param message        A string to identify this event in the portal.
   * @param properties     map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   */
  private logTrace(context: core.TurnContext, message: string, severityLevel: any, properties?: IDictionary) {
    let logProperties =  this.getLogProperties(context, properties);
    this.appInsightsClients.forEach(client => client.trackTrace(message, severityLevel, logProperties));
  }

  /**
   * Log an exception you have caught.
   * @param   exception   An Error from a catch clause, or the string error message.
   * @param   properties  map[string, string] - additional data used to filter events and metrics in the portal. Defaults to empty.
   */
  private logException(context: core.TurnContext, exception: Error, properties?: IDictionary) {
    let logProperties =  this.getLogProperties(context, properties);
    this.appInsightsClients.forEach(client => client.trackException(exception, logProperties));
  }
}
