declare var _default: {
    CustomEvent: {
        name: string;
        format: {
            text: string;
            type: string;
            timestamp: string;
            conversationId: string;
            channel: string;
            userId: string;
            userName: string;
        };
    };
    UserMessage: {
        name: string;
        format: {
            text: string;
            type: string;
            timestamp: string;
            conversationId: string;
            channel: string;
            userId: string;
            userName: string;
        };
    };
    BotMessage: {
        name: string;
        format: {
            text: string;
            type: string;
            timestamp: string;
            conversationId: string;
        };
    };
    StartTransaction: {
        name: string;
        format: {
            name: string;
            timestamp: string;
            channel: string;
            conversationId: string;
            userId: string;
            userName: string;
        };
    };
    EndTransaction: {
        name: string;
        format: {
            name: string;
            successful: string;
            count: string;
            timestamp: string;
            channel: string;
            conversationId: string;
            callstack_length: string;
            userId: string;
            userName: string;
        };
    };
    Intent: {
        name: string;
        format: {
            intent: string;
            state: string;
            channel: string;
            conversationId: string;
            callstack_length: string;
            userId: string;
            userName: string;
        };
    };
    Entity: {
        name: string;
        format: {
            intent: string;
            entityType: string;
            entityValue: string;
            state: string;
            channel: string;
            conversationId: string;
            callstack_length: string;
            userId: string;
            userName: string;
        };
    };
    Sentiment: {
        name: string;
        format: {
            text: string;
            score: string;
            timestamp: string;
            channel: string;
            conversationId: string;
            userId: string;
            userName: string;
        };
    };
    QnaEvent: {
        name: string;
        format: {
            score: string;
            timestamp: string;
            channel: string;
            conversationId: string;
            userId: string;
            userName: string;
            userQuery: string;
            kbQuestion: string;
            kbAnswer: string;
        };
    };
};
export default _default;
