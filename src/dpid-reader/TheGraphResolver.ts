import { SortDirection } from "api/v1/list";
import axios from "axios";
import parentLogger from "../logger";
const logger = parentLogger.child({ module: "TheGraphResolver" });

/**
 * 
 * @param url 
 * @param prefix 
 * @returns 
 * 
 {
  "data": {
    "registers": [
      {
        "transactionHash": "0xe029123d7dd74c529f459000c3c7c65e4b98d540e5b021ac9abaf597e3165c60",
        "entryId": "54"
      },
      ...
    ]
  }
 */
export const getAllDpidRegisrations = async (
    url: string,
    prefix: string,
    page: number,
    size: number,
    orderDirection: SortDirection = "desc"
) => {
    const q = `
  {
    registers(
      where: {prefix: "${prefix}"}
      orderBy: entryId
      orderDirection: ${orderDirection},
      first: ${size},
      skip: ${(page - 1) * size}
    ) {
      transactionHash
      entryId
    }
  }`;
    return query(url, q);
};

export const getAllResearchObjectsForDpidRegistrations = async (url: string, dpidTransactionHashes: string[]) => {
    const q = `{
    researchObjectVersions(
      where: {id_in: ["${dpidTransactionHashes.join('", "')}"]}
      orderBy: time
      orderDirection: desc
    ) {
      id
      cid
      researchObject {
        id
        versions(orderBy: time) {
          id
          time
          cid
        }
      }
    }
  }`;
    return query(url, q);
};

export const getIndexedResearchObjects = async (url: string, hex: string[]) => {
    const q = `{
      researchObjects(where: { id_in: ["${hex.join('","')}"]}) {
        id, id10, recentCid, owner, versions(orderBy: time, orderDirection: desc) {
          cid, id, time
        }
      } 
    }`;
    return query(url, q);
};

export const query = async (url: string, query: string) => {
    const payload = JSON.stringify({
        query,
    });
    const { data } = await axios.post(url, payload);
    if (data.errors) {
        logger.error(data.errors, `graph index query err ${query}`);
        throw Error(JSON.stringify(data.errors));
    }
    return data.data;
};
