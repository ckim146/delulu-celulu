export type InitResponse = {
  type: 'init';
  postId: string;
  count: number;
  username: string;
};

export type IncrementResponse = {
  type: 'increment';
  postId: string;
  count: number;
};

export type DecrementResponse = {
  type: 'decrement';
  postId: string;
  count: number;
};

export type Round = {
  id: string;
  imageUrl: string;
  answer: 'Delulu' | 'Celulu';
  celebrityName?: string;
  used: boolean;
};
