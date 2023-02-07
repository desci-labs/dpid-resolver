import axios from "axios";

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
        console.error(`graph index query err ${query}`, JSON.stringify(data.errors));
        throw Error(JSON.stringify(data.errors));
    }
    return data.data;
};