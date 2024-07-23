import { Cell } from '@ton/core';
import { loadMintBounce, loadUpdatePositionBounce, MintBounce, UpdatePositionBounce } from '../wrappers/Pool';

export const parsePoolBounceMessage = (message: Cell | null): UpdatePositionBounce | MintBounce | null => {
    if (message === null) return null;

    try {
        const updatePositionMsg = loadUpdatePositionBounce(message.asSlice());
        return updatePositionMsg;
    } catch (error) {}

    try {
        const mintMsg = loadMintBounce(message.asSlice());
        return mintMsg;
    } catch (error) {}
    console.log('Failed to parse bounce message');
    return null;
};
