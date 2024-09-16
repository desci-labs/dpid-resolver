/** Strip did provider and eip155 chainId, leaving the standard hex address */
export const cleanupEip155Address = (eipAddress: string) => eipAddress.replace(/did:pkh:eip155:[0-9]+:/, "");
