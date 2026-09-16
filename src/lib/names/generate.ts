import { customAlphabet } from "nanoid";
import { adjectives, animals, colors } from "unique-names-generator";

/** Retries with a fresh name after the first attempt, before the suffixed attempt (PRD 6.3). */
export const MAX_NAME_RETRIES = 5;

const WORD_LISTS = [adjectives, colors, animals];

const randomSuffix = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 4);

/**
 * A room name like "brave-crimson-otter": adjective, color and animal from
 * unique-names-generator's dictionaries (about 22 million combinations).
 * `rng` must behave like `Math.random`; values outside [0, 1) are clamped.
 * Not unique by itself: the database's `chatrooms_name_key` constraint is.
 */
export function generateRoomName(rng: () => number = Math.random): string {
  return WORD_LISTS.map((words) => {
    const index = Math.floor(rng() * words.length);
    return words[Math.min(Math.max(index, 0), words.length - 1)];
  }).join("-");
}

/** Appends a collision-breaking suffix: "brave-crimson-otter-x7k2". */
export function withSuffix(name: string, nanoidFn: () => string = randomSuffix): string {
  return `${name}-${nanoidFn()}`;
}

/**
 * Thrown by an insert attempt when the generated name is already taken
 * (SQLSTATE 23505 on `chatrooms_name_key`). Any other failure, including a
 * coordinate conflict, must be thrown as a different error.
 */
export class NameCollision extends Error {
  constructor(message = "Room name is already taken") {
    super(message);
    this.name = "NameCollision";
  }
}

export type InsertWithUniqueNameOptions = {
  /** Nonnegative safe integer; retries after the first attempt. Default {@link MAX_NAME_RETRIES}. */
  maxRetries?: number;
  /** Name source. Default {@link generateRoomName}; tests pass a deterministic one. */
  generateName?: () => string;
  /** Suffix source for the final attempt. Default: a random 4-character nanoid. */
  suffix?: () => string;
};

/**
 * Runs `tryInsert` with generated names until one is free (PRD 6.3): the first
 * attempt, up to `maxRetries` retries with new names, then one attempt with a
 * suffixed name. Errors other than {@link NameCollision} are rethrown at once.
 * If the suffixed attempt also collides, its NameCollision propagates and the
 * route answers 503 with a retryable error. Invalid retry budgets reject with
 * RangeError before any name generation or insert attempt.
 */
export async function insertWithUniqueName<T>(
  tryInsert: (name: string) => Promise<T>,
  opts: InsertWithUniqueNameOptions = {},
): Promise<T> {
  const { maxRetries = MAX_NAME_RETRIES, generateName = generateRoomName, suffix } = opts;
  if (!Number.isSafeInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError("maxRetries must be a nonnegative safe integer");
  }

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await tryInsert(generateName());
    } catch (error) {
      if (!(error instanceof NameCollision)) throw error;
    }
  }

  return tryInsert(withSuffix(generateName(), suffix));
}
