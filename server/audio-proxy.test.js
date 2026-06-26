import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { proxyAudioRequest } from "./audio-proxy.js";

test("audio proxy catches upstream stream termination instead of crashing the server", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.error(new TypeError("terminated"));
    }
  });
  const res = createMockResponse();

  await assert.doesNotReject(() => proxyAudioRequest({
    target: "http://music.example/audio.mp3",
    range: "",
    res,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "audio/mpeg"]]),
      body
    })
  }));

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["content-type"], "audio/mpeg");
  assert.match(res.destroyError?.message || "", /terminated|upstream/i);
});

test("audio proxy consumes late readable errors after headers are sent", async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      setTimeout(() => controller.error(new DOMException("The operation was aborted due to timeout", "TimeoutError")), 0);
    }
  });
  const res = createMockResponse();

  await assert.doesNotReject(() => proxyAudioRequest({
    target: "http://music.example/audio.mp3",
    range: "",
    res,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Map([["content-type", "audio/mpeg"]]),
      body
    })
  }));

  assert.equal(res.statusCode, 200);
  assert.match(res.destroyError?.message || "", /timeout|upstream/i);
});

test("audio proxy does not pass a whole-request timeout signal to long lived audio streams", async () => {
  let fetchOptions = null;
  const res = createMockResponse();

  await proxyAudioRequest({
    target: "http://music.example/audio.mp3",
    range: "bytes=0-99",
    res,
    fetchImpl: async (_url, options) => {
      fetchOptions = options;
      return {
        ok: true,
        status: 206,
        headers: new Map([["content-type", "audio/mpeg"]]),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            controller.close();
          }
        })
      };
    }
  });

  assert.equal(fetchOptions.signal, undefined);
  assert.deepEqual(fetchOptions.headers, { Range: "bytes=0-99" });
});

function createMockResponse() {
  const chunks = [];
  const res = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  res.statusCode = 200;
  res.headers = {};
  res.headersSent = false;
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.setHeader = (key, value) => {
    res.headers[key.toLowerCase()] = value;
    res.headersSent = true;
    return res;
  };
  res.getHeader = (key) => res.headers[key.toLowerCase()];
  res.send = (body) => {
    res.sentBody = body;
    res.headersSent = true;
    res.end();
    return res;
  };
  const originalDestroy = res.destroy.bind(res);
  res.destroy = (error) => {
    res.destroyError = error;
    originalDestroy();
    return res;
  };
  return res;
}
