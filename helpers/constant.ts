export const RAY = BigInt('1000000000000000000000000000');
export const WAD = BigInt('1000000000000000000');
export const PERCENTAGE_FACTOR = BigInt('10000');

export const ACTION_BORROW = 0n;
export const ACTION_WITHDRAW = 1n;
export const ACTION_TRANSFER_ATOKEN = 2n;
export const ACTION_LIQUIDATION = 3n;
export const ACTION_REPAY = 4n;

export const RERUN_ACTION_UPDATE_POSITION = 100n;
export const RERUN_ACTION_MINT = 101n;
export const RERUN_ACTION_TOKEN_TRANSFER = 102n;
export const RERUN_ACTION_TOKEN_BURN = 103n;

// 5 minutes
export const EXPIRATION_PERIOD = 300n;
// reject when price +30% or -30%, based on 10000;
export const MAX_DEVIATION_RATE = 3000n;
