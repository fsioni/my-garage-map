import { Effect, Layer } from "effect";
import { DocumentStorage } from "../../application/ports.js";
import { ValidationError } from "../../domain/errors.js";
import { validateDocumentPath } from "../../domain/rules.js";

export const documentStorageLayer = (root?: string) =>
  Layer.succeed(DocumentStorage, {
    validate: (localPath) => {
      const validated = validateDocumentPath(localPath, root);
      return validated === null
        ? Effect.fail(
            new ValidationError({
              message: "Document path is outside GARAGE_DOCUMENT_ROOT",
            }),
          )
        : Effect.succeed(validated);
    },
  });
