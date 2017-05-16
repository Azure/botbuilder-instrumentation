export default {
  UserMessage: {
    name: 'MBFEvent.UserMessage',
    format: { 
      text: 'message.text', 
      type: 'message.type',
      timestamp: 'message.timestamp',
      conversationId: 'message.address.conversation.id',
      channel: 'address.channelId',
      userId: 'user.id',
      userName: 'user.name'
    }
  },
  BotMessage: {
    name: 'MBFEvent.BotMessage',
    format: { 
      text: 'message.text', 
      type: 'message.type',
      timestamp: '(new Date()).toISOString()',
      conversationId: 'message.address.conversation.id'
    }
  },
  StartTransaction: {
    name: 'MBFEvent.StartTransaction',
    format: { 
      name: 'conversion name',
      timestamp: 'message.timestamp',
      channel: 'address.channelId - facebook/slack/webchat/etc...',
      conversationId: 'conversation.id',
      userId: 'user.id',
      userName: 'user.name'
    }
  },
  EndTransaction: {
    name: 'MBFEvent.EndTransaction',
    format: {
      name: 'conversion name - similar to start',
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
  Intent: {
    name: 'MBFEvent.Intent',
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
  Entity: {
    name: 'MBFEvent.Entity',
    format: { 
      intent: 'intent name / id / string',
      entityType: 'entity type',
      entityValue: 'entity value',
      state: 'current session state',
      channel: 'address.channelId',
      conversationId: 'conversation.id',
      callstack_length: 'callstack.length',
      userId: 'user.id',
      userName: 'user.name'
    }
  },
  Sentiment: {
    name: 'MBFEvent.Sentiment',
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
};