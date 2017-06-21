# Adding Logging to an Existing bot
Follow these steps:

## Connect to Application Insights

1. Create an Application Insights service under your subscription.
2. Use the `Instrumentation Key` inside your bot registration page under _Instrumentation key_.
3. Under the App Insights serivce, go to **API Access** and copy **Application ID**
4. Under the App Insights serivce, go to **API Access >> New Key** with _Read_ permissions and copy **Api Key**.

## Connect to Cognitive Services
Create a new [Sentiment Analisys Service under Cognitive Services](https://www.microsoft.com/cognitive-services/en-us/text-analytics-api).
When creating the service, make sure to mark **Text Analytics - Preview**.

## Setting Environment Variables

```sh
APPINSIGHTS_INSTRUMENTATIONKEY={App Insights Instrumentation Key}
CG_SENTIMENT_KEY={Cognitive Services Text Analytics Key}
```

## Connecting to Code

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY,
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);
```

## Using mutiple instrumnetation keys

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: ["main insturmnation key","secondary instumentation key"],
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);
```

## Sending logs for QnA maker service

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: ["main insturmnation key","secondary instumentation key"],
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);

//hook into the result function of QNA to extract relevant data for logging.
loggins.trackQNAEvent(context, userQuery, kbQuestion, kbAnswer, score);
//You can see a working sample in [https://github.com/Microsoft/BotBuilder-CognitiveServices/tree/master/Node/samples/QnAMakerWithFunctionOverrides](https://github.com/Microsoft/BotBuilder-CognitiveServices/tree/master/Node/samples/QnAMakerWithFunctionOverrides)
```

## Sending custom event data

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logging = new instrumentation.BotFrameworkInstrumentation({ 
  instrumentationKey: ["main insturmnation key","secondary instumentation key"],
  sentimentKey: process.env.CG_SENTIMENT_KEY,
});
logging.monitor(bot);
let customEventName = 'myCustomEventName'; //This will show up as the event name in Application Insights.
let customEventData = { customeDataA: 'customValueA', customDataB: 3 };
logging.trackCustomEvent(context, customEventName, customEventData); //Custom key-value data. It will be avaiable under the customDimentions column in Application Insights.
```

You can see a working sample in [https://github.com/morsh/bot-with-instrumentation](https://github.com/morsh/bot-with-instrumentation)