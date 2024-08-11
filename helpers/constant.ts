import { pTON } from '@ston-fi/sdk';

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

export const UINT256_MAX = 2n ** 256n - 1n;

// ACL ROLEs

export const ACL = {
    DEFAULT_ADMIN_ROLE: 0n,
    POOL_ADMIN_ROLE: 1n,
    ASSET_LISTING_ADMIN_ROLE: 2n,
    RISK_ADMIN_ROLE: 3n,
    EMERGENCY_ADMIN_ROLE: 4n,
};

export const MAINNET_ADDRESS = {
    USDT: 'EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs',
    pTON: new pTON.v1().address,
    STONFI_V1_ROUTER: 'EQB3ncyBUTjZUA5EnFKR5_EnOMI9V1tTEAAPaiU71gc4TiUt',
};

export const TESTNET_ADDRESS = {
    USDT: '',
    pTON: "EQDTrtiFWwyA2rx1Yasw0TuyK_UqtLxkRcqIXfWbJqOnQEgo",
    STONFI_V1_ROUTER: 'kQD7GHQoIk00-z7dzjagREolRpwprM_ogDEiOF1v8jOo-mkn',
};
