import { Cell } from '@ton/core';
import { loadMint, loadUpdatePosition, Mint, UpdatePosition } from '../wrappers/Pool';

export const parsePoolBounceMessage = (message: Cell | null): UpdatePosition | Mint | null => {
    if (message === null) return null;

    try {
        const updatePositionMsg = loadUpdatePosition(message.asSlice());
        return updatePositionMsg;
    } catch (error) {}

    try {
        const mintMsg = loadMint(message.asSlice());
        return mintMsg;
    } catch (error) {}
    console.log('Failed to parse bounce message');
    return null;
};
