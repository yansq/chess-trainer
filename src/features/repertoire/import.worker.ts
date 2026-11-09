import { importRepertoirePgn } from "./model";
self.onmessage = (event) => {
  try {
    self.postMessage({
      book: importRepertoirePgn(event.data.book, event.data.text),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
