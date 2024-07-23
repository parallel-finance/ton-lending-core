import { Cell } from '@ton/core';
import {
    loadMintBounce,
    loadTokenBurnBounce,
    loadTokenTransferBounce,
    loadUpdatePositionBounce,
    MintBounce,
    TokenBurnBounce,
    TokenTransferBounce,
    UpdatePositionBounce,
} from '../wrappers/Pool';

export const parsePoolBounceMessage = (
    message: Cell | null,
): UpdatePositionBounce | MintBounce | TokenTransferBounce | TokenBurnBounce | null => {
    if (message === null) return null;

    try {
        const updatePositionMsg = loadUpdatePositionBounce(message.asSlice());
        return updatePositionMsg;
    } catch (error) {}

    try {
        const mintMsg = loadMintBounce(message.asSlice());
        return mintMsg;
    } catch (error) {}

    try {
        const tokenTransferMsg = loadTokenTransferBounce(message.asSlice());
        return tokenTransferMsg;
    } catch (error) {}

    try {
        const tokenBurnMsg = loadTokenBurnBounce(message.asSlice());
        return tokenBurnMsg;
    } catch (error) {}
    console.log('Failed to parse bounce message');
    return null;
};
