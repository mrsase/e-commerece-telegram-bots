import { Bot } from "grammy";

export type AnyBot = Bot;

export function createClientBot(token: string): AnyBot {
  const bot = new Bot(token);
  return bot;
}

export function createManagerBot(token: string): AnyBot {
  const bot = new Bot(token);
  return bot;
}

export function createCourierBot(token: string): AnyBot {
  const bot = new Bot(token);
  return bot;
}
