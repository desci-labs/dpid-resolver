import type { Request, Response } from "express";
import { getComposeClient } from "../../../util/config.js";

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

type ResearchObjectQueryResponse = ResearchObjectQueryFmt[] | ResearchObjectQueryError;

type ResearchObjectQueryFmt = Omit<GqlResearchObject, "owner"> & { owner: string };

type ResearchObjectQueryError = string;

export const objectQueryHandler = async (
    _req: Request<unknown, unknown, unknown>,
    res: Response<ResearchObjectQueryResponse>,
): Promise<typeof res> => {
    const composeClient = getComposeClient();

    const response = await composeClient.executeQuery<{
        researchObjectIndex: { edges: { node: GqlResearchObject }[] };
    }>(gqlAllResearchObjects);

    if (!response.data) {
        return res.status(500).send("failed to get research objects");
    }

    const objects: ResearchObjectQueryFmt[] = response.data.researchObjectIndex.edges
        .map((e) => e.node)
        .filter((n) => n !== null) // filter out unresolvable dev nodes
        .map((n) => ({ ...n, owner: n.owner.id }));

    return res.send(objects);
};
