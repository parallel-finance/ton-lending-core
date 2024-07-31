import { Address, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { OracleProvider } from '../wrappers/OracleProvider';

export async function run(provider: NetworkProvider) {
    console.log('Deploying oracle provider...')
    // const pool = provider.open(Pool.fromAddress(Address.parse("")))
    const pool = provider.open(await Pool.fromInit())
    // EQDsohOIWyDi3gGGaPQ5gllERwshyWe1t_6sn0afyDZgUVfj
    console.log("pool address: ", pool.address.toString())
    const oracleProvider = provider.open(await OracleProvider.fromInit(pool.address));
    await sleep(2000);
    
    await oracleProvider.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'Deploy',
            queryId: 0n,
        }
    );
    await sleep(2000);
    await provider.waitForDeploy(oracleProvider.address);
    // EQAH741FN2wBTqbuIjZtNcVGTx6fIYckJCC8A0T-kW3MwLRM
    console.log(`OracleProvider Deployed at ${oracleProvider.address.toString()}`);
}
