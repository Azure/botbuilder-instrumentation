# Botbuilder Instrumentation

## Getting Started

### Prerequisites
* Node v7+

### Connect to Application Insights:
1. Create an [Application Insights service](https://azure.microsoft.com/en-gb/services/application-insights/) under your Azure subscription.
2. Use the `Instrumentation Key` inside your bot registration page under _Instrumentation key_.
3. Under the App Insights service, go to **API Access** and copy **Application ID**
4. Under the App Insights service, go to **API Access >> New Key** with _Read_ permissions and copy **Api Key**.

### (optional) Connect to Cognitive Services:
Create a new [Sentiment Analysis Service under Cognitive Services](https://www.microsoft.com/cognitive-services/en-us/text-analytics-api).
When creating the service, make sure to mark **Text Analytics - Preview**.

## Setup
Key-Credential setup can be accomplished by one of the following means:

### Set the following env vars:
Recommend using the `dotenv` npm package

```bash
APPINSIGHTS_INSTRUMENTATIONKEY={App Insights Instrumentation Key}
CG_SENTIMENT_KEY={Cognitive Services Text Analytics Key} //optional
```

### Then in your code:

```js
var instrumentation = require('botbuilder-instrumentation');

// Setting up advanced instrumentation
let logger = new instrumentation.BotFrameworkInstrumentation({
  instrumentationKey: process.env.APPINSIGHTS_INSTRUMENTATIONKEY, //required
  sentimentKey: process.env.CG_SENTIMENT_KEY,
  autoLogOptions: {
    autoCollectConsole: true, //default is false
    autoCollectExceptions: true, //default is false
    autoCollectRequests: true, //default is false
    autoCollectPerf: true //default is false
  }
});

logger.monitor(bot);
```

## Using
You can see a working integration sample in the [multilingual-uber-bot](https://github.com/User1m/multilingual-uber-bot) sample

### Logging custom fields with every logging statement

There are 2 ways to log custom parameters:

#### 1. Log custom objects

```js
...(Setup - as above)

let customDataHolder = {
    name: "Claudius",
    age: 24
}
    
logger.setCustomFields(customDataHolder);

customDataHolder["newData"]="Adding new data to be logged always";

//all objects found the customDataHolder will be logged
//customDataHolder can be updated to add new data

```

#### 2. Log custom key paths
- Generally you will want to log data from the [msbf](https://dev.botframework.com/) session object. For example user preference data stored in `session.userData`. But you may not want to log every key-value pair in `session.userData` as there maybe personally identifiable information (PII). 
- Well just provide the data container and the key(s) you want logged and we'll ignore all other keys in that object

```js
...(Setup - as above)

session.userData["user_cc"] = '8808-8888-8080-8888';
session.userData["user_country"] = 'USA';
session.userData["user_lang"] = 'English';

logger.setCustomFields(session.userData, ["user_country","user_lang"]);

//"user_cc" will not be logged. Only keys specified (country, lang) will be logged

```

`logger.setCustomFields()` can be called as many times as needed.


### Sending custom event data & custom errors
Method signatures:

```js
public logCustomEvent(eventName: string, session: builder.Session, properties?: { [key: string]: string })
```

```js
public logCustomError(error: Error, session: builder.Session, properties?: { [key: string]: string })
```
Use:

```js
...(Setup - as above)

let customEventName = 'myCustomEventName'; 

let customEventData = { customeDataA: 'customValueA', customDataB: 3 };

logger.logCustomEvent(customEventName, session, customEventData); 

logger.logCustomError(error, session, customEventData); 

//'session' is the msbf session object
```

### Sending logs for QnA maker service
You can see a working sample in [QnAMakerWithFunctionOverrides](https://github.com/Microsoft/BotBuilder-CognitiveServices/tree/master/Node/samples/QnAMakerWithFunctionOverrides)

Method signature:

```js
public logQNAEvent(userQuery: string, session: builder.Session, kbQuestion: string, kbAnswer: string, score: any)
```
Use:

```js
...(Setup - as above)

logger.logQNAEvent(userQuery, session, kbQuestion, kbAnswer, score);

//'session' is the msbf session object

```

### Logging from multiple bots - for multibot applications
- Call `instrumentation.setCurrentBotName()` in the rootDialog of that bot or library
- Calling the `instrumentation.setCurrentBotName()` function ensures that the  bot currently being interacted with is identified in logging statements. 
- You need access to the msbf `session` object as this is the 

```js
...(Setup - as above)

_lib.dialog('/', [
    function(session, results, next) {
    	instrumentation.setCurrentBotName(session, "My Bot Name")
    }
]);

//'session' is the msbf session object
``` 

You can see a working integration sample in the [multilingual-uber-bot](https://github.com/User1m/multilingual-uber-bot) sample

## Built With

* Typescript
* NodeJS

## Contributing

Please read [CONTRIBUTING.md](https://gist.github.com/PurpleBooth/b24679402957c63ec426) for details on our code of conduct, and the process for submitting pull requests to us.


## Authors

* **Mor Shemesh** - *Initial work* - [morsh](https://github.com/morsh)
* **Claudius Mbemba** - *Re-work, Orchestrator bot analytics & Custom Filters capabilities* - [User1m](https://github.com/User1m)
* **Stye Richter** - *QnA logger* - [itye-msft](https://github.com/itye-msft)


## License

This project is licensed under the MIT License 

## Acknowledgments

* [Microsoft Botframework](https://dev.botframework.com/)