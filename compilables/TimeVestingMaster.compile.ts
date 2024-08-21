import { CompilerConfig } from '@ton/blueprint';

export const compile: CompilerConfig = {
    lang: 'tact',
    target: 'contracts/sTay/time-vesting-master.tact',
    options: {
        debug: true,
    },
};
