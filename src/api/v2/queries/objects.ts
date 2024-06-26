import type { Request, Response } from "express";
import { getComposeClient } from "../../../util/config.js";

export type ObjectQueryRequest = {
  streamIds?: string[];
};

const gqlAllResearchObjects = `query {
  researchObjectIndex(first: 1000) {
    edges {
      node {
        id
        owner {
          id
        }
        manifest
        title
      }
    }
  } 
}`;

const gqlSomeResearchObjects = `query ($streamIds: [ID!]!) {
  nodes(ids: $streamIds) {
    ... on ResearchObject {
      id
      title
      owner {
        id
      }
      manifest
    }
  }
}`;

type GqlResearchObject = {
  /** streamID */
  id: string,
  owner: {
    /** owner DID in format did:pkh:eip155:1337:0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 */
    id: string
  },
  /** manifest CID, latest version */
  manifest: string,
  /** research object title */
  title: string,
};

export const objectQueryHandler = async (
  req: Request<unknown, unknown, ObjectQueryRequest>,
  res: Response,
) => {
  const streamIds = req.body.streamIds;
  
  const composeClient = getComposeClient();

  const response = await composeClient.executeQuery<{
    researchObjectIndex: { edges: { node: GqlResearchObject }[] };
  }>(
    streamIds === undefined
      ? gqlAllResearchObjects
      : gqlSomeResearchObjects,
    { streamIds }
  );

  const streamQueries = response.data!.researchObjectIndex.edges
    .map(e => e.node)
    .map(n => ({ streamId: n.id }));

  const mqResponse = await composeClient.context.ceramic.multiQuery(streamQueries);

  res.send(JSON.stringify(response, undefined, 2))
  // const researchObjects = response.data!.researchObjectIndex.edges
  //   .map(e => e.node)
  //   .map(n => ({ ...n, owner: n.owner.id }));
  // console.log("RESEARCH OBJECTS:", JSON.stringify(researchObjects, undefined, 2))
};
