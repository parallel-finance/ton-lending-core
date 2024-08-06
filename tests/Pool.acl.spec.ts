import { Blockchain, BlockchainSnapshot, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { Address, toNano } from '@ton/core';
import { Pool } from '../wrappers/Pool';
import { ACL } from '../helpers/constant';
import { deployPool } from './utils';

describe('Pool ACL test', () => {
    let blockchain: Blockchain;
    let snapshot: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;

    let addresses: any = {};

    jest.setTimeout(60 * 1000);

    beforeAll(async () => {
        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        addresses.deployer = deployer.address;
        secondUser = (await blockchain.createWallets(2))[1];
        addresses.secondUser = secondUser.address;

        pool = blockchain.openContract(await Pool.fromInit());
        // deploy pool
        await deployPool(pool, deployer);
        addresses.pool = pool.address;
    });

    beforeEach(async () => {
        snapshot = blockchain.snapshot();
    });
    afterEach(async () => {
        await blockchain.loadFrom(snapshot);
        priceAddresses();
    });

    const priceAddresses = () => {
        const printAddress: any = {};
        Object.entries(addresses).forEach(([key, value]) => {
            printAddress[key] = (value as Address).toString();
        });
    };

    const grantRole = async (role: bigint, admin: Address) => {
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'GrantRole',
                role,
                admin,
            },
        );
        const roleData = await pool.getRoleData(role);
        expect(roleData?.members.has(admin)).toEqual(true);
        expect(await pool.getHasRole(role, admin)).toEqual(true);
    };

    const revokeRole = async (role: bigint, admin: Address) => {
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'RevokeRole',
                role,
                admin,
            },
        );
        const roleData = await pool.getRoleData(role);
        expect(roleData?.members.has(admin)).toEqual(false);
        expect(await pool.getHasRole(role, admin)).toEqual(false);
    };

    it('grant role', async () => {
        await grantRole(ACL.DEFAULT_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.POOL_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.ASSET_LISTING_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.EMERGENCY_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
    });

    it('grant role failed because sender is not defaultAdmin', async () => {
        const result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'GrantRole',
                role: ACL.POOL_ADMIN_ROLE,
                admin: secondUser.address,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
    });

    it('revoke role', async () => {
        await grantRole(ACL.DEFAULT_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.POOL_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.ASSET_LISTING_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.EMERGENCY_ADMIN_ROLE, secondUser.address);
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        await revokeRole(ACL.DEFAULT_ADMIN_ROLE, secondUser.address);
        await revokeRole(ACL.POOL_ADMIN_ROLE, secondUser.address);
        await revokeRole(ACL.ASSET_LISTING_ADMIN_ROLE, secondUser.address);
        await revokeRole(ACL.EMERGENCY_ADMIN_ROLE, secondUser.address);
        await revokeRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
    });

    it('revoke role failed because sender is not defaultAdmin', async () => {
        await grantRole(ACL.POOL_ADMIN_ROLE, secondUser.address);
        const result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'RevokeRole',
                role: ACL.POOL_ADMIN_ROLE,
                admin: secondUser.address,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
    });

    it('renounce role', async () => {
        await grantRole(ACL.DEFAULT_ADMIN_ROLE, secondUser.address);
        await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'RenounceRole',
                role: ACL.DEFAULT_ADMIN_ROLE,
            },
        );
        const roleData = await pool.getRoleData(ACL.DEFAULT_ADMIN_ROLE);
        expect(roleData?.members.has(secondUser.address)).toEqual(false);
    });
});
