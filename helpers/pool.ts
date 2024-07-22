import { Cell } from '@ton/core';
import { loadMint, loadUpdatePosition, Mint, UpdatePosition } from '../wrappers/Pool';

export const parsePoolBounceMessage = (message: Cell | null): UpdatePosition | Mint | null => {
    if (message === null) return null;
    const msgSlice = message.asSlice();

    try {
        const updatePositionMsg = loadUpdatePosition(msgSlice);
        return updatePositionMsg;
    } catch (error) {}

    try {
        const mintMsg = loadMint(msgSlice);
        return mintMsg;
    } catch (error) {}
    console.log('Failed to parse bounce message');
    return null;
};
