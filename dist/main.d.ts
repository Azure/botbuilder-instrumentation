import * as builder from 'botbuilder';
export interface ISentimentSettings {
    minWords?: number;
    url?: string;
    id?: string;
    key?: string;
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
export declare const CURRENT_BOT_NAME = "currentBotName";
export declare function setCurrentBotName(session: any, botName: string): any;
export declare class BotFrameworkInstrumentation {
    settings: IInstrumentationSettings;
    private appInsightsClient;
    private currentBotName;
    private console;
    private methods;
    private customFields;
    private instrumentationKey;
    private sentiments;
    constructor(settings: IInstrumentationSettings);
    private formatArgs(args);
    private setupConsoleCollection();
    private collectSentiment(session, text);
    private updateProps(props, customFields?);
    private getBotName(session);
    private prepProps(session);
    private setupInstrumentation(autoCollectConsole?, autoCollectExceptions?, autoCollectRequests?, autoCollectPerf?);
    monitor(bot: builder.UniversalBot): void;
    setCustomFields(objectContainer: Object, keys?: string | string[]): void;
    startTransaction(session: builder.Session, name?: string): void;
    endTransaction(session: builder.Session, name?: string, successful?: boolean): void;
    private prepareLogData(session, item);
    logCustomEvent(eventName: string, session: builder.Session, properties?: {
        [key: string]: string;
    }): void;
    logCustomError(error: Error, session: builder.Session, properties?: {
        [key: string]: string;
    }): void;
    logQNAEvent(userQuery: string, session: builder.Session, kbQuestion: string, kbAnswer: string, score: any): void;
    private trackEvent(name, properties?, measurements?, tagOverrides?, contextObjects?);
    private trackTrace(message, severityLevel?, properties?, tagOverrides?, contextObjects?);
    private trackException(exception, properties?, measurements?, tagOverrides?, contextObjects?);
}
