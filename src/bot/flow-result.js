export function reply(text, options = {}) {
  return {
    type: 'reply',
    text,
    ...options,
  };
}

export function noReply() {
  return { type: 'no_reply' };
}
