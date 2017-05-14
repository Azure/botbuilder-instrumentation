import * as util from 'util';
import * as _ from 'lodash';
import * as builder from 'botbuilder';
import request from 'request';
import ApplicationInsights = require("applicationinsights");

import Events from './events';

export interface IInstrumentationSettings {
  instrumentationKey?: string;
  sentiments?: {
    minWords?: number,
    url?: string,
    id?: string,
    key?: string
  }
}

export class BotFrameworkInstrumentation {

  private appInsightsClient = null;

  private console = {};
  private methods = {
    "debug": 0,
    "info": 1,
    "log": 2,
    "warn": 3,
    "error":4
  };

  private settings: IInstrumentationSettings = {
    sentiments: {
      minWords: 3,
      url: 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment',
      id: 'bot-analytics',
      key: null
    }
  };

  constructor(settings?: IInstrumentationSettings) {

    settings = settings || {};
    _.extend(this.settings.sentiments, settings.sentiments);

    this.settings.sentiments.key = this.settings.sentiments.key || process.env.CG_SENTIMENT_KEY;

    this.settings.instrumentationKey = settings.instrumentationKey || process.env.APPINSIGHTS_INSTRUMENTATIONKEY;

    if (!this.settings.instrumentationKey) {
      throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
    }

    if (!this.settings.sentiments.key) {
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

          let stdout = null;
          try {
            
            let msg = this.formatArgs(args);
            this.appInsightsClient.trackTrace(msg, this.methods[method]);

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

    if (!this.settings.sentiments.key) return;
    if (text.match(/\S+/g).length < this.settings.sentiments.minWords) return;
    
    var _message = session.message || {};
    var _address = _message.address || {};
    var _conversation = _address.conversation || {};
    var _user = _address.user || {};
    
    request({
      url: this.settings.sentiments.url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Ocp-Apim-Subscription-Key': this.settings.sentiments.key
      },
      json: true,
      body: {
        "documents": [
          {
            "language": "en",
            "id": this.settings.sentiments.id,
            "text": text
          }
        ]
      }
    }, 
    (error, response, body) => {

      if (error) {
        return this.appInsightsClient.trackException(error);
      }

      try {
        let result: any = _.find(body.documents, { id: this.settings.sentiments.id }) || {};
        var score = result.score || null;

        if (isNaN(score)) {
          throw new Error('Could not collect sentiment');
        }

        var item = { 
          text: text, 
          score: score,
          timestamp: _message.timestamp,
          channel: _address.channelId,
          conversationId: _conversation.id,
          userId: _user.id,
          userName: _user.name
        };

        this.appInsightsClient.trackEvent(Events.Sentiment.name, item);
      } catch (error) {
        return this.appInsightsClient.trackException(error);
      }
    });
  }

  monitor (bot: builder.UniversalBot) {

    ApplicationInsights.setup(this.settings.instrumentationKey).start();
    this.appInsightsClient = ApplicationInsights.getClient(this.settings.instrumentationKey);

    this.setupConsoleCollection();

    // Adding middleware to intercept all user messages
    if (bot) {
      bot.use({
        botbuilder: function (session, next) {

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
            
            this.appInsightsClient.trackEvent(Events.UserMessage.name, item);
          } catch (e) { 
          } finally {
              next();
          }
        },
        send: (message: any, next: (err?: Error) => void) => {
          try {

            let address = message.address || {};
            let conversation = address.conversation || {};
            let user = address.user || {};

            let item =  { 
              text: message.text,
              type: message.type,
              timestamp: message.timestamp,
              conversationId: conversation.id
            };

            this.appInsightsClient.trackEvent(Events.BotMessage.name, item);
          } catch (e) {
          }
          finally {
            next();
          }
        }
      });
    }

    // Monitoring new dialog calls like session.beginDialog
    // When beginning a new dialog, the framework uses pushDialog to change context 
    // to a new dialog
    // Todo: Check alternative as <builder.SimpleDialog.prototype.begin>
    // builder.Session.prototype..pushDialog = (function() {
    //   var orig = builder.Session.prototype.pushDialog;
    //   return function (args) {
        
    //     var _session = this;
    //     var _message = _session.message || {};
    //     var _address = _message.address || {};
    //     var _conversation = _address.conversation || {};
    //     var _user = _address.user || {};
    //     var _callstack = _session.sessionState.callstack;

    //     var item = { 
    //       intent: args && args.id,
    //       state: args && args.state && JSON.stringify(args.state),
    //       channel: _address.channelId,
    //       conversationId: _conversation.id,
    //       callstack_length: _callstack.length.toString(),
    //       userId: _user.id,
    //       userName: _user.name
    //     };

    //     _.take(_callstack, 3).forEach((stackItem: any, idx: number) => {
    //       item[`callstack_${idx}_id`] = stackItem.id;
    //       item[`callstack_${idx}_state`] = JSON.stringify(stackItem.state);
    //     });

    //     this.appInsightsClient.trackEvent(Events.Intents.name, item);

    //     orig.apply(_session, [args]);
    //   }
    // })();

    // Capture message session before send
    // builder.Session.prototype.prepareMessage = (function() {
    //   var orig = builder.Session.prototype.prepareMessage;
    //   return function (msg) {

    //     var _session = this;
    //     var res = orig.apply(_session, [msg]);
    //     if (_session.dialogData['transaction.started']) { 

    //       var transactionEnded = false;
    //       var success = false;
    //       var conversation = _.find(transactions, { intent: _session.dialogData['transaction.id'] });
    //       if (conversation.intent != _session.dialogData['BotBuilder.Data.Intent']) {
    //         transactionEnded = true;
    //       } else {
    //         var test = conversation.test;
    //         var success = typeof test == 'string' ? test == msg.text : test.test(msg.text);
    //         if (success) {
    //           transactionEnded = true;
    //         }
    //       }

    //       if (transactionEnded) {
    //         endConverting(_session, null, success);
    //         delete _session.dialogData['transaction.started'];
    //         delete _session.dialogData['transaction.id'];
    //       }
    //     }
        
    //     return res;
    //   }
    // })();
    

    // Collect intents collected from LUIS after entities were resolved
    builder.IntentDialog.prototype.recognize = (() => {
      let _recognize = builder.IntentDialog.prototype.recognize;
      return function(context, cb) {

        let _dialog = this;
        _recognize.apply(_dialog, [context, (err, result) => {

          var entities = [];
          if (result && result.entities) {
            result.entities.forEach(value => {
              entities.push({
                type: value.type,
                entity: value.entity
              })
            });
          }

          let message = context.message;
          let address = message.address || {};
          let conversation = address.conversation || {};
          let user = address.user || {};

          let item =  { 
            text: message.text,
            timestamp: message.timestamp,
            intent: result && result.intent, 
            channel: address.channelId,
            score: result && result.score,
            entities: entities,
            withError: !err,
            error: err,
            conversationId: conversation.id,
            userId: user.id,
            userName: user.name
          };

          this.appInsightsClient.trackEvent(Events.Intent.name, item);

          // transactions.forEach(cc => {
          //   if (cc.intent == item.intent) {
          //     startConverting(context, null);
          //     context.dialogData['transaction.started'] = true;
          //     context.dialogData['transaction.id'] = cc.intent;
          //   }
          // });

          this.collectSentiment(context, message.text);

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

    this.appInsightsClient.trackEvent(Events.StartTransaction.name, item);
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

    this.appInsightsClient.trackEvent(Events.EndTransaction.name, item);
  }
}