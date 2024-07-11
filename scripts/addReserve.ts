import { address, toNano } from '@ton/core';
import { Pool, ReserveConfiguration } from '../wrappers/Pool';
import { NetworkProvider } from '@ton/blueprint';
import { SampleJetton } from '../build/SampleJetton/tact_SampleJetton';

export async function run(provider: NetworkProvider) {
    const pool = provider.open(await Pool.fromInit());
    console.log(`Deployed Pool at ${pool.address.toString()}`);
    const reserveAddress = address('EQAFy5Wqx0HmUVQFcSTNpceFAVa8WikjyIUvWxdbqd0BsE6D');
    const sampleJetton = provider.open(SampleJetton.fromAddress(reserveAddress));
    const poolWalletAddress = await sampleJetton.getGetWalletAddress(pool.address);

    const reserveConfiguration : ReserveConfiguration= {
        $$type: 'ReserveConfiguration',

        // TODO: change to real addresses
        poolWalletAddress,
        lTokenAddress: reserveAddress,
        dTokenAddress: reserveAddress,

        ltv: 6000n,
        liquidationThreshold: 750n,
        liquidationBonus: 500n,
        reserveFactor: 1000n,
        liquidationProtocolFee: 50n,
        optimalUsageRatio: 7000n,
        slope1: 1000n,
        slope2: 3000n,
        borrowingEnabled: true,
        supplyCap: 1000000n,
        borrowCap: 1000000n
    };

    await pool.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'AddReserve',
            reserveAddress,
            reserveConfiguration,
        }
    );

    await provider.waitForDeploy(pool.address);
}
