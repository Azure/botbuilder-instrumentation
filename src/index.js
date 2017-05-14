var util = require('util');
var _ = require('lodash');
var request = require('request');
var builder = require('botbuilder');
var appInsights = require("applicationinsights");

var client = null;

var _console = {};
var _methods = {
  "debug": 0,
  "info": 1,
  "log": 2,
  "warn": 3,
  "error":4
};

var _sentimentMinWords = 3;
var _sentimentUrl = 'https://westus.api.cognitive.microsoft.com/text/analytics/v2.0/sentiment';
var _sentimentId = 'bot-analytics';
var _sentimentKey = null;

var Events = {
  ReceiveMessage: {
    name: 'message.received',
    format: { 
      text: 'message.text', 
      type: 'message.type',
      timestamp: 'message.timestamp',
      conversationId: 'message.address.conversation.id'
    }
  },
  SendMessage: {
    name: 'message.send',
    format: { 
      text: 'message.text', 
      type: 'message.type',
      timestamp: '(new Date()).toISOString()',
      conversationId: 'message.address.conversation.id'
    }
  },
  ConversionStarted: {
    name: 'message.convert.start',
    format: { 
      name: 'comversion name',
      timestamp: 'message.timestamp',
      channel: 'address.channelId - facebook/slack/webchat/etc...',
      conversationId: 'conversation.id',
      userId: 'user.id',
      userName: 'user.name'
    }
  },
  ConversionEnded: {
    name: 'message.convert.end',
    format: {
      name: 'comversion name - similar to start',
      successful: 'true/false', 
      count: 'default is 1, but can log more than 1',
      timestamp: 'message.timestamp',
      channel: 'address.channelId',
      conversationId: 'conversation.id',
      callstack_length: 'callstack.length - how many dialogs/steps are in the stack',
      userId: 'user.id',
      userName: 'user.name'
    }
  },
  Intents: {
    name: 'message.intent.dialog',
    format: { 
      intent: 'intent name / id / string',
      state: 'current session state',
      channel: 'address.channelId',
      conversationId: 'conversation.id',
      callstack_length: 'callstack.length',
      userId: 'user.id',
      userName: 'user.name'
    }
  },
  Sentiment: {
    name: 'message.sentiment',
    format: { 
      text: 'message.text', 
      score: 'sentiment score',
      timestamp: 'message.timestamp',
      channel: 'address.channelId',
      conversationId: 'conversation.id',
      userId: 'user.id',
      userName: 'user.name'
    }
  }
}

var formatArgs = (args) => {
  return util.format.apply(util.format, Array.prototype.slice.call(args));
}

var setup = () => {

  Object.keys(_methods).forEach(method => {

    console[method] = (function() {
      var orig = console.log;
      return function() {
        try {
          
          var msg = formatArgs(arguments);
          client.trackTrace(msg, _methods[method]);

          var tmp = process.stdout;
          process.stdout = process.stderr;
          orig.apply(console, arguments);
        } finally {
          process.stdout = tmp;
        }
      };
    })();      
  });
}

/**
 * Monitor requests made to the bot framework
 * @param {UniversalBot} bot
 * @param {ConversionConfig} conversionConfig
 */
var monitor = (bot, options) => {

  options = options || {};

  if ((!options.instrumentationKey) &&
      (!process.env.APPINSIGHTS_INSTRUMENTATIONKEY)){
    throw new Error('App Insights instrumentation key was not provided in options or the environment variable APPINSIGHTS_INSTRUMENTATIONKEY');
  }

  appInsights.setup(options.instrumentationKey || process.env.APPINSIGHTS_INSTRUMENTATIONKEY).start();
  client = appInsights.getClient(options.instrumentationKey || process.env.APPINSIGHTS_INSTRUMENTATIONKEY);

  if (!options.sentimentKey && !process.env.CG_SENTIMENT_KEY) {
    console.warn('No sentiment key was provided - text sentiments will not be collected');
  } else {
    _sentimentKey = options.sentimentKey || process.env.CG_SENTIMENT_KEY;
  }

  var transactions = options.transactions || [];
  setup();

  if (bot) {
    // Adding middleware to intercept all received messages
    bot.use({
        botbuilder: function (session, next) {

            try {
              var message = session.message;
              var address = message.address || {};
              var conversation = address.conversation || {};
              var user = address.user || {};

              var item =  { 
                text: message.text,
                type: message.type,
                timestamp: message.timestamp,
                conversationId: conversation.id,
                channel: address.channelId,
                userId: user.id,
                userName: user.name
              };
              
              client.trackEvent(Events.ReceiveMessage.name, item);
            } catch (e) { 
            } finally {
                next();
            }
        },
        send: function (message, next) {
          try {
            var b = bot;
            client.trackEvent(Events.SendMessage.name, { 
                text: message.text, 
                type: message.type,
                timestamp: (new Date()).toISOString(),
                conversationId: message.address && message.address.conversation && message.address.conversation.id
              });
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
  builder.Session.prototype.pushDialog = (function() {
    var orig = builder.Session.prototype.pushDialog;
    return function (args) {
      
      var _session = this;
      var _message = _session.message || {};
      var _address = _message.address || {};
      var _conversation = _address.conversation || {};
      var _user = _address.user || {};
      var _callstack = _session.sessionState.callstack;

      var item = { 
        intent: args && args.id,
        state: args && args.state && JSON.stringify(args.state),
        channel: _address.channelId,
        conversationId: _conversation.id,
        callstack_length: _callstack.length.toString(),
        userId: _user.id,
        userName: _user.name
      };

      _.take(_callstack, 3).forEach((stackItem, idx) => {
        item[`callstack_${idx}_id`] = stackItem.id;
        item[`callstack_${idx}_state`] = JSON.stringify(stackItem.state);
      });

      client.trackEvent(Events.Intents.name, item);

      orig.apply(_session, [args]);
    }
  })();

  // Capture message session before send
  builder.Session.prototype.prepareMessage = (function() {
    var orig = builder.Session.prototype.prepareMessage;
    return function (msg) {

      var _session = this;
      var res = orig.apply(_session, [msg]);
      if (_session.dialogData['transaction.started']) { 

        var transactionEnded = false;
        var success = false;
        var conversation = _.find(transactions, { intent: _session.dialogData['transaction.id'] });
        if (conversation.intent != _session.dialogData['BotBuilder.Data.Intent']) {
          transactionEnded = true;
        } else {
          var test = conversation.test;
          var success = typeof test == 'string' ? test == msg.text : test.test(msg.text);
          if (success) {
            transactionEnded = true;
          }
        }

        if (transactionEnded) {
          endConverting(_session, null, success);
          delete _session.dialogData['transaction.started'];
          delete _session.dialogData['transaction.id'];
        }
      }
      
      return res;
    }
  })();
  

  // Collect intents collected from LUIS after entities were resolved
  builder.IntentDialog.prototype.recognize = (function() {
    var _recognize = builder.IntentDialog.prototype.recognize;
    return function(context, cb) {

      var _dialog = this;
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

        var message = context.message;
        var address = message.address || {};
        var conversation = address.conversation || {};
        var user = address.user || {};

        var item =  { 
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

        client.trackEvent("message.intent.received", item);

        transactions.forEach(cc => {
          if (cc.intent == item.intent) {
            startConverting(context, null);
            context.dialogData['transaction.started'] = true;
            context.dialogData['transaction.id'] = cc.intent;
          }
        });

        collectSentiment(context, message.text);

        // Todo: on "set alarm" utterence, failiure
        return cb(err, result);
      }]);          
    };
  })();  
}

var collectSentiment = (session, text) => {

  text = text || '';

  if (!_sentimentKey) return;
  if (text.match(/\S+/g).length < _sentimentMinWords) return;
  
  var _message = session.message || {};
  var _address = _message.address || {};
  var _conversation = _address.conversation || {};
  var _user = _address.user || {};
  
  request({
    url: _sentimentUrl,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Ocp-Apim-Subscription-Key': _sentimentKey
    },
    json: true,
    body: {
      "documents": [
        {
          "language": "en",
          "id": _sentimentId,
          "text": text
        }
      ]
    }
  }, 
  (error, response, body) => {

    if (error) {
      return client.trackException(error);
    }

    try {
      var score = _.find(body.documents, { id: _sentimentId }).score;
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

      client.trackEvent(Events.Sentiment.name, item);
    } catch (error) {
      return client.trackException(error);
    }
  });
}

var startConverting = (session, name) => {
  name = name || 'default';
  var _message = session.message || {};
  var _address = _message.address || {};
  var _conversation = _address.conversation || {};
  var _user = _address.user || {};

  var item = { 
    name,
    timestamp: _message.timestamp,
    channel: _address.channelId,
    conversationId: _conversation.id,
    userId: _user.id,
    userName: _user.name
  };

  client.trackEvent(Events.ConversionStarted.name, item);
}

var endConverting = (session, name, successful, count) => {
  name = name || 'default';
  count = isNaN(count) && 1 || count;
  successful = successful !== false;
  var _message = session.message || {};
  var _address = _message.address || {};
  var _conversation = _address.conversation || {};
  var _user = _address.user || {};
  var _callstack = session.sessionState.callstack;

  var item = {
    name,
    successful: successful.toString(), 
    count: count.toString(),
    timestamp: _message.timestamp,
    channel: _address.channelId,
    conversationId: _conversation.id,
    callstack_length: _callstack.length.toString(),
    userId: _user.id,
    userName: _user.name
  };

  client.trackEvent(Events.ConversionEnded.name, item);
}

var measure = (session, name, count) => {
  name = name || 'default';
  count = count || 1;
  var _message = session.message || {};
  var _address = _message.address || {};
  var _conversation = _address.conversation || {};
  var _user = _address.user || {};
  var _callstack = session.sessionState.callstack;

  var item = {
    timestamp: _message.timestamp,
    channel: _address.channelId,
    conversationId: _conversation.id,
    callstack_length: _callstack.length.toString(),
    userId: _user.id,
    userName: _user.name
  };
  client.trackEvent('custom-' + name, item, { count });
}

module.exports = {
  monitor,
  measure
}