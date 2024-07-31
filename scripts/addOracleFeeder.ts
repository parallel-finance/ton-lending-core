import { Address, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { NetworkProvider, sleep } from '@ton/blueprint';
import { OracleProvider } from '../wrappers/OracleProvider';
import { waitForTx } from '../helpers/address';

export async function run(provider: NetworkProvider, args: string[]) {
    console.log('add oracle feeder...');
    const ui = provider.ui();
    const feeder = Address.parse(
        (args.length > 0 ? args[0] : await ui.input(`feeder address, default: ${provider.sender().address}`)) ||
            provider.sender().address?.toString() ||
            '',
    );

    // const pool = provider.open(Pool.fromAddress(Address.parse("")))
    const pool = provider.open(await Pool.fromInit());
    // EQDsohOIWyDi3gGGaPQ5gllERwshyWe1t_6sn0afyDZgUVfj
    console.log('pool address: ', pool.address.toString());
    const oracleProvider = provider.open(await OracleProvider.fromInit(pool.address));
    console.log('oracleProvider address: ', oracleProvider.address.toString());
    await sleep(2000);

    await oracleProvider.send(
        provider.sender(),
        {
            value: toNano('0.05'),
        },
        {
            $$type: 'AddFeeder',
            feeder,
        },
    );
    await waitForTx(provider, oracleProvider.address as Address, true);
    console.log(`feeder ${feeder.toString()} added... `);
    console.log(
        `current feeders`,
        (await oracleProvider.getOracleData()).feeders.keys().map((v) => v.toString()),
    );
}
