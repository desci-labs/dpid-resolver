import type { Request, Response } from "express";
import { getComposeClient } from "../../../util/config.js";
import { listResearchObjects } from "@desci-labs/desci-codex-lib/c1/explore";
import logger from "../../../logger.js";
import { flightClient } from "../../../flight.js";

const MODULE_PATH = "api/v2/queries/owner" as const;

const gqlAllResearchObjects = `query {
  researchObjectIndex(first: 1000) {
    edges {
      node {
        id
        version
        owner {
          id
        }
        manifest
        title
      }
    }
  }
}`;

type GqlResearchObject = {
    /** streamID */
    id: string;
    owner: {
        /** owner DID in format did:pkh:eip155:1337:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 */
        id: string;
    };
    /** manifest CID, latest version */
    manifest: string;
    /** research object title */
    title: string;
};

type OwnerQueryParams = {
    /** Owner ID from path parameter */
    id?: string;
};

type OwnerQueryResponse = OwnerQueryFmt[] | OwnerQueryError;

type OwnerQueryFmt = Omit<GqlResearchObject, "owner"> & { owner: string };

type OwnerQueryError = {
    error: string;
    details: string;
    params: unknown;
    path: typeof MODULE_PATH;
};

export const ownerQueryHandler = async (
    req: Request<OwnerQueryParams, unknown, unknown>,
    res: Response<OwnerQueryResponse>,
): Promise<typeof res> => {
    const { id: ownerId } = req.params;

    if (!ownerId) {
        return res.status(400).send({
            error: "invalid request",
            details: "missing owner id in path parameter",
            params: req.params,
            path: MODULE_PATH,
        });
    }

    logger.info({ ownerId }, "handling owner query");

    try {
        let allObjects: OwnerQueryFmt[];

        if (flightClient) {
            try {
                const c1researchObjects = await listResearchObjects(flightClient);
                allObjects = c1researchObjects;
            } catch (error) {
                logger.error(error, "Error fetching research objects with flight client");
                return res.status(500).send({
                    error: "failed to fetch research objects",
                    details: "flight client error",
                    params: req.params,
                    path: MODULE_PATH,
                });
            }
        } else {
            const composeClient = getComposeClient();

            const response = await composeClient.executeQuery<{
                researchObjectIndex: { edges: { node: GqlResearchObject }[] };
            }>(gqlAllResearchObjects);

            if (!response.data) {
                return res.status(500).send({
                    error: "failed to get research objects",
                    details: "no data returned from compose client",
                    params: req.params,
                    path: MODULE_PATH,
                });
            }

            allObjects = response.data.researchObjectIndex.edges
                .map((e) => e.node)
                .filter((n) => n !== null) // filter out unresolvable dev nodes
                .map((n) => ({ ...n, owner: n.owner.id }));
        }

        // Filter by owner - match against the owner field
        // Owner can be in format: did:pkh:eip155:1337:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
        // or just the address part: 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
        const filteredObjects = allObjects.filter((obj) => {
            // Check if owner matches exactly or if the owner DID ends with the provided id
            return obj.owner === ownerId || obj.owner.toLowerCase().endsWith(ownerId.toLowerCase());
        });

        return res.send(filteredObjects);
    } catch (error) {
        logger.error(error, "Error in owner query handler");
        return res.status(500).send({
            error: "internal server error",
            details: error instanceof Error ? error.message : "unknown error",
            params: req.params,
            path: MODULE_PATH,
        });
    }
};
