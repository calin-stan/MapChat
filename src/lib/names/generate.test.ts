import { adjectives, animals, colors } from "unique-names-generator";
import { describe, expect, it, vi } from "vitest";

import {
  generateRoomName,
  insertWithUniqueName,
  MAX_NAME_RETRIES,
  NameCollision,
  withSuffix,
} from "@/lib/names/generate";

const THREE_WORDS = /^[a-z]+-[a-z]+-[a-z]+$/;

/** An rng that replays `values` in a loop. */
function replay(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

/** Names "name-1", "name-2", ... in call order. */
function counter(): () => string {
  let n = 0;
  return () => `name-${++n}`;
}

describe("generateRoomName", () => {
  it("builds adjective-color-animal from the rng", () => {
    expect(generateRoomName(replay(0))).toBe(`${adjectives[0]}-${colors[0]}-${animals[0]}`);
  });

  it("is deterministic for the same rng sequence", () => {
    const expected = [
      adjectives[Math.floor(0.1 * adjectives.length)],
      colors[Math.floor(0.5 * colors.length)],
      animals[Math.floor(0.9 * animals.length)],
    ].join("-");

    expect(generateRoomName(replay(0.1, 0.5, 0.9))).toBe(expected);
    expect(generateRoomName(replay(0.1, 0.5, 0.9))).toBe(expected);
  });

  it("stays inside the word lists for rng values at or past the edges", () => {
    expect(generateRoomName(replay(0.9999999999, 1, -0.1))).toBe(
      `${adjectives[adjectives.length - 1]}-${colors[colors.length - 1]}-${animals[0]}`,
    );
  });

  it("produces varied lowercase three-word names with the default rng", () => {
    const names = Array.from({ length: 50 }, () => generateRoomName());
    for (const name of names) expect(name).toMatch(THREE_WORDS);
    expect(new Set(names).size).toBeGreaterThan(1);
  });
});

describe("withSuffix", () => {
  it("appends the given suffix", () => {
    expect(withSuffix("brave-crimson-otter", () => "x7k2")).toBe("brave-crimson-otter-x7k2");
  });

  it("defaults to a random 4-character [0-9a-z] suffix", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(withSuffix("brave-crimson-otter")).toMatch(/^brave-crimson-otter-[0-9a-z]{4}$/);
    }
  });
});

describe("NameCollision", () => {
  it("is an Error with its own name", () => {
    const error = new NameCollision();
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("NameCollision");
    expect(error.message).toBe("Room name is already taken");
  });
});

describe("insertWithUniqueName", () => {
  const namesTried = (fn: { mock: { calls: [string][] } }) => fn.mock.calls.map(([name]) => name);

  it("returns the first successful insert", async () => {
    const tryInsert = vi.fn(async (name: string) => `room:${name}`);

    await expect(insertWithUniqueName(tryInsert, { generateName: counter() })).resolves.toBe(
      "room:name-1",
    );
    expect(namesTried(tryInsert)).toEqual(["name-1"]);
  });

  it("retries with a new name after a name collision", async () => {
    let calls = 0;
    const tryInsert = vi.fn(async (name: string) => {
      calls += 1;
      if (calls <= 2) throw new NameCollision();
      return `room:${name}`;
    });

    await expect(insertWithUniqueName(tryInsert, { generateName: counter() })).resolves.toBe(
      "room:name-3",
    );
    expect(namesTried(tryInsert)).toEqual(["name-1", "name-2", "name-3"]);
  });

  it("makes 1 attempt plus 5 retries, then one suffixed attempt, then gives up", async () => {
    const tryInsert = vi.fn(async (name: string): Promise<string> => {
      throw new NameCollision(`taken: ${name}`);
    });

    await expect(
      insertWithUniqueName(tryInsert, { generateName: counter(), suffix: () => "x7k2" }),
    ).rejects.toBeInstanceOf(NameCollision);

    expect(MAX_NAME_RETRIES).toBe(5);
    expect(namesTried(tryInsert)).toEqual([
      "name-1",
      "name-2",
      "name-3",
      "name-4",
      "name-5",
      "name-6",
      "name-7-x7k2",
    ]);
  });

  it("returns the suffixed attempt when it succeeds", async () => {
    const tryInsert = vi.fn(async (name: string) => {
      if (!name.endsWith("-x7k2")) throw new NameCollision();
      return `room:${name}`;
    });

    await expect(
      insertWithUniqueName(tryInsert, { generateName: counter(), suffix: () => "x7k2" }),
    ).resolves.toBe("room:name-7-x7k2");
  });

  it("rethrows any other error at once, without retrying", async () => {
    const failure = new Error("connection refused");
    const tryInsert = vi.fn(async (): Promise<string> => {
      throw failure;
    });

    await expect(insertWithUniqueName(tryInsert, { generateName: counter() })).rejects.toBe(failure);
    expect(tryInsert).toHaveBeenCalledTimes(1);
  });

  it("rethrows another error raised during a retry", async () => {
    const failure = new Error("coordinates taken");
    let calls = 0;
    const tryInsert = vi.fn(async (): Promise<string> => {
      calls += 1;
      if (calls === 1) throw new NameCollision();
      throw failure;
    });

    await expect(insertWithUniqueName(tryInsert, { generateName: counter() })).rejects.toBe(failure);
    expect(tryInsert).toHaveBeenCalledTimes(2);
  });

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid maxRetries %s before attempting an insert",
    async (maxRetries) => {
      const tryInsert = vi.fn(async (name: string) => `room:${name}`);
      const generateName = vi.fn(() => "room-name");
      const suffix = vi.fn(() => "x7k2");

      await expect(
        insertWithUniqueName(tryInsert, { maxRetries, generateName, suffix }),
      ).rejects.toThrow(new RangeError("maxRetries must be a nonnegative safe integer"));
      expect(tryInsert).not.toHaveBeenCalled();
      expect(generateName).not.toHaveBeenCalled();
      expect(suffix).not.toHaveBeenCalled();
    },
  );

  it("honours maxRetries", async () => {
    const tryInsert = vi.fn(async (name: string): Promise<string> => {
      throw new NameCollision(`taken: ${name}`);
    });

    await expect(
      insertWithUniqueName(tryInsert, {
        maxRetries: 0,
        generateName: counter(),
        suffix: () => "x7k2",
      }),
    ).rejects.toBeInstanceOf(NameCollision);
    expect(namesTried(tryInsert)).toEqual(["name-1", "name-2-x7k2"]);
  });
});
