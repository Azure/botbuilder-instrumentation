# Microsoft Bot Builder Instrumentation
This module is used to add instrumentation to bots built with [Microsoft Bot Framework](https://dev.botframework.com/).
You can leverage the events from this module using [Ibex Dashboard](https://github.com/CatalystCode/ibex-dashboard).

## Getting Started

1. Create an Application Insights service under your subscription.
2. Use the `Instrumentation Key` inside your bot registration page under _Instrumentation key_.


## Connect to Cognitive Services
This is an optional step in case you want user messages to be analyzed for sentiments.
Create a new [Sentiment Analysis Service under Cognitive Services](https://www.microsoft.com/cognitive-services/en-us/text-analytics-api).
When creating the service, make sure to mark **Text Analytics - Preview**.

## Setting Environment Variables
You can use the following option for running locally.

```bash
APPINSIGHTS_INSTRUMENTATIONKEY={App Insights Instrumentation Key}
CG_SENTIMENT_KEY={Cognitive Services Text Analytics Key}
```

`CG_SENTIMENT_KEY` is optional.

## Adding instrumentation to your code

```js
const instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATION_KEY,
  sentiments: {
    key: process.env.CG_SENTIMENT_KEY,
  }
});
let recognizer = new builder.LuisRecognizer('...');
logging.monitor(bot, recognizer);
``` 

If you're not using a `LuisRecognizer', use the following code in addition:

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATION_KEY,
  sentiments: {
    key: process.env.CG_SENTIMENT_KEY,
  }
});
logging.monitor(bot);
```

Although `CG_SENTIMENT_KEY` is optional, it is recommended if you're using [Ibex Dashboard](https://github.com/CatalystCode/ibex-dashboard), in which case, adding sentiment analysis will add sentiments overview to the dashboard along with a sentiment icon next to all conversations.

## Sending logs for QnA maker service

```js
// Hook into the result function of QNA to extract relevant data for logging.
logging.trackQNAEvent(context, userQuery, kbQuestion, kbAnswer, score);
```

You can see how to implement a QnA service [here](https://github.com/Microsoft/BotBuilder-CognitiveServices/tree/master/Node/samples/QnAMakerWithFunctionOverrides).

## Additional settings

```js
let logger = new instrumentation.BotFrameworkInstrumentation({
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATION_KEY,
  sentiments: {
    key: process.env.CG_SENTIMENT_KEY,
  },

  // Will omit the user name from the logs for anonimization
  omitUserName: true,

  // Application insights options, all set to false by default
  autoLogOptions: { 
    autoCollectConsole: true,
    autoCollectExceptions: true,
    autoCollectRequests: true,
    autoCollectPerf: true // (auto collect performance)
  }
  
  customFields: {
    userData: [ "CUSTOM_PROPERTY_1" ],
    dialogData: [ "CUSTOM_PROPERTY_2" ],
    conversationData: [ "CUSTOM_PROPERTY_3" ],
    privateConversationData: [ "CUSTOM_PROPERTY_4" ]
  }
});
```

The `CUSTOM_PROPERTY` could be a String or an Array. If it's an array it will as a path. [Lodash#get](https://lodash.com/docs#get)

The `CUSTOM_PROPERTY` will be searched for in the session/context object of each event and will be added automatically under customDimensions in Application Insights.
If it does not exist, it will not be added to the logged events.
You can use any, all or none of the property bags under session: `userData`, `conversationData`, `privateConversationData`, `dialogData`.

## Logging custom events

You can track generic goal triggers, just like you would trigger a goal in Google Analytics for a web site. A triggered goal has a name and
optionally custom properties that can be attached to the goal. Triggered goals can be seen in the Generic Goals Triggered dashboard template.

```js
// This will show up as the event name in Application Insights.
let customEventName = 'myCustomEventName';
// Custom key-value data. It will be avaiable under the customDimensions column in Application Insights.
let customEventData = { customDataA: 'customValueA', customDataB: 3 };

// You can log using context (session), in which case, session variables like timespan, userId etc will also be logged
logging.trackCustomEvent(customEventName, customEventData, session); 

// You can log without a session/context
logging.trackCustomEvent(customEventName, customEventData); 

// And you can log without an event name, in which case the event name will be 'MBFEvent.CustomEvent'
logging.trackEvent(customEventData);
```

## Logging generic goal triggers

```js
// Custom key-value data. It will be avaiable under the customDimensions column in Application Insights.
let customEventData = { customDataA: 'customValueA', customDataB: 3 };

// goalName is the name of the goal you want to trigger. e.g. "Goal A". You log using context (session), in which case, session variables like timespan, userId etc will also be logged
logging.trackGoalTriggeredEvent(goalName, customEventData, session); 

```

You can see a working sample in [morsh/bot-with-instrumentation](https://github.com/morsh/bot-with-instrumentation)

## License
This project is licensed under the MIT License.
