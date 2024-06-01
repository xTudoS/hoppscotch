import { Environment, HoppCollection, HoppRESTRequest } from "@hoppscotch/data";
import fs from "fs/promises";
import { entityReference } from "verzod";
import { z } from "zod";

import { TestCmdOptions } from "../types/commands";
import { error } from "../types/errors";
import { FormDataEntry } from "../types/request";
import { isHoppErrnoException } from "./checks";
import { getResourceContents } from "./getters";

const getValidRequests = (
  collections: HoppCollection[],
  collectionFilePath: string
) => {
  return collections.map((collection) => {
    // Validate requests using zod schema
    const requestSchemaParsedResult = z
      .array(entityReference(HoppRESTRequest))
      .safeParse(collection.requests);

    // Handle validation errors
    if (!requestSchemaParsedResult.success) {
      throw error({
        code: "MALFORMED_COLLECTION",
        path: collectionFilePath,
        data: "Please check the collection data.",
      });
    }

    // Recursively validate requests in nested folders
    if (collection.folders.length > 0) {
      collection.folders = getValidRequests(
        collection.folders,
        collectionFilePath
      );
    }

    // Return validated collection
    return {
      ...collection,
      requests: requestSchemaParsedResult.data,
    };
  });
};

/**
 * Parses array of FormDataEntry to FormData.
 * @param values Array of FormDataEntry.
 * @returns FormData with key-value pair from FormDataEntry.
 */
export const toFormData = (values: FormDataEntry[]) => {
  const formData = new FormData();

  values.forEach(({ key, value }) => formData.append(key, value));

  return formData;
};

/**
 * Parses provided error message to maintain hopp-error messages.
 * @param e Custom error data.
 * @returns Parsed error message without extra spaces.
 */
export const parseErrorMessage = (e: unknown) => {
  let msg: string;
  if (isHoppErrnoException(e)) {
    msg = e.message.replace(e.code! + ":", "").replace("error:", "");
  } else if (typeof e === "string") {
    msg = e;
  } else {
    msg = JSON.stringify(e);
  }
  return msg.replace(/\n+$|\s{2,}/g, "").trim();
};

export async function readJsonFile(
  path: string,
  fileExistsInPath: boolean
): Promise<HoppCollection | Environment> {
  if (!path.endsWith(".json")) {
    throw error({ code: "INVALID_FILE_TYPE", data: path });
  }

  if (!fileExistsInPath) {
    throw error({ code: "FILE_NOT_FOUND", path });
  }

  try {
    return JSON.parse((await fs.readFile(path)).toString());
  } catch (e) {
    throw error({ code: "UNKNOWN_ERROR", data: e });
  }
}

/**
 * Parses collection json file for given path:context.path, and validates
 * the parsed collectiona array
 * @param pathOrId Collection json file path
 * @param [options] Supplied values for CLI flags
 * @param [options.accessToken] Personal access token to fetch workspace environments
 * @param [options.serverUrl] server URL for SH instance
 * @returns For successful parsing we get array of HoppCollection
 */
export async function parseCollectionData(
  pathOrId: string,
  options: Omit<TestCmdOptions, "env" | "delay">
): Promise<HoppCollection[]> {
  const { token: accessToken, server: serverUrl } = options;

  const contents = (await getResourceContents({
    pathOrId,
    accessToken,
    serverUrl,
    resourceType: "collection",
  })) as HoppCollection;

  const maybeArrayOfCollections: HoppCollection[] = Array.isArray(contents)
    ? contents
    : [contents];

  const collectionSchemaParsedResult = z
    .array(entityReference(HoppCollection))
    .safeParse(maybeArrayOfCollections);

  if (!collectionSchemaParsedResult.success) {
    throw error({
      code: "MALFORMED_COLLECTION",
      path: pathOrId,
      data: "Please check the collection data.",
    });
  }

  return getValidRequests(collectionSchemaParsedResult.data, pathOrId);
}
