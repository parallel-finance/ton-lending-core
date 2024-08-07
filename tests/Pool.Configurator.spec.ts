import { Blockchain, BlockchainSnapshot, printTransactionFees, SandboxContract, TreasuryContract } from '@ton/sandbox';
import '@ton/test-utils';
import { Address, Cell, toNano } from '@ton/core';
import { ATokenDTokenContents, Pool, ReserveConfiguration, ReserveInterestRateStrategy } from '../wrappers/Pool';
import { ACL, UINT256_MAX } from '../helpers/constant';
import { addReserve, deployJetton, deployPool, mintJetton, supplyJetton } from './utils';
import { SampleJetton } from '../wrappers/SampleJetton';
import { buildOnchainMetadata } from '../scripts/utils';
import { JettonDefaultWallet } from '../build/SampleJetton/tact_JettonDefaultWallet';
import { AToken } from '../build/Pool/tact_AToken';
import { DToken } from '../build/Pool/tact_DToken';
import { UserAccount } from '../build/Pool/tact_UserAccount';
import { sleep } from '@ton/blueprint';
import { ATokenDefaultWallet } from '../build/Pool/tact_ATokenDefaultWallet';

describe('Pool Configurator test', () => {
    let blockchain: Blockchain;
    let snapshot: BlockchainSnapshot;
    let deployer: SandboxContract<TreasuryContract>;
    let secondUser: SandboxContract<TreasuryContract>;
    let treasury: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;
    let sampleJetton1: SandboxContract<SampleJetton>;
    let addresses: any = {};

    let reserveConfiguration1: ReserveConfiguration;
    let reserveInterestRateStrategy: ReserveInterestRateStrategy;
    let contents1: ATokenDTokenContents;

    jest.setTimeout(60 * 1000);

    beforeAll(async () => {
        reserveInterestRateStrategy = {
            $$type: 'ReserveInterestRateStrategy',
            optimalUsageRatio: BigInt(0.9 * 10 ** 27),
            maxUsageRatio: BigInt(10 ** 27) - BigInt(0.9 * 10 ** 27),
            baseBorrowRate: 0n,
            slope1: BigInt(0.04 * 10 ** 27),
            slope2: BigInt(0.6 * 10 ** 27),
        };

        blockchain = await Blockchain.create();
        deployer = await blockchain.treasury('deployer');
        secondUser = await blockchain.treasury('secondUser');
        treasury = await blockchain.treasury('treasury');
        addresses.deployer = deployer.address;
        addresses.secondUser = secondUser.address;
        addresses.treasury = treasury.address;

        pool = blockchain.openContract(await Pool.fromInit());
        // deploy pool
        await deployPool(pool, deployer);
        addresses.pool = pool.address;

        let max_supply = toNano(100000000n); // 🔴 Set the specific total supply in nano
        let content1 = buildOnchainMetadata({
            name: 'SampleJetton 1',
            description: 'Sample Jetton 1',
            decimals: '9',
            image: '',
            symbol: 'SAM1',
        });
        contents1 = {
            $$type: 'ATokenDTokenContents',
            aTokenContent: buildOnchainMetadata({
                name: 'SampleJetton 1 AToken',
                description: 'Sample Jetton 1 aToken',
                decimals: '9',
                image: '',
                symbol: 'aSAM1',
            }),
            dTokenContent: buildOnchainMetadata({
                name: 'SampleJetton 1 DToken',
                description: 'Sample Jetton 1 dToken',
                decimals: '9',
                image: '',
                symbol: 'dSAM1',
            }),
        };
        let content2 = buildOnchainMetadata({
            name: 'SampleJetton 2',
            description: 'Sample Jetton 2',
            decimals: '6',
            image: '',
            symbol: 'SAM2',
        });

        sampleJetton1 = blockchain.openContract(await SampleJetton.fromInit(deployer.address, content1, max_supply));

        await sampleJetton1.send(
            deployer.getSender(),
            {
                value: toNano('0.05'),
            },
            {
                $$type: 'Deploy',
                queryId: 0n,
            },
        );

        const getPoolWalletAndATokenAndDToken = async (
            jetton: SandboxContract<SampleJetton>,
            contents: ATokenDTokenContents,
        ): Promise<{
            poolWalletAddress: Address;
            aTokenAddress: Address;
            dTokenAddress: Address;
        }> => {
            return {
                poolWalletAddress: await jetton.getGetWalletAddress(pool.address),
                aTokenAddress: await pool.getCalculateATokenAddress(contents.aTokenContent, jetton.address),
                dTokenAddress: await pool.getCalculateDTokenAddress(contents.dTokenContent, jetton.address),
            };
        };

        addresses.sampleJetton1 = sampleJetton1.address;

        const {
            poolWalletAddress: poolWalletAddress1,
            aTokenAddress: aTokenAddress1,
            dTokenAddress: dTokenAddress1,
        } = await getPoolWalletAndATokenAndDToken(sampleJetton1, contents1);

        addresses.poolWalletAddress1 = poolWalletAddress1;
        addresses.aTokenAddress1 = aTokenAddress1;
        addresses.dTokenAddress1 = dTokenAddress1;
        const commonReserveConfiguration = {
            ltv: 6000n,
            liquidationThreshold: 7500n,
            liquidationBonus: 10500n,
            reserveFactor: 1000n,
            liquidationProtocolFee: 500n,
            isActive: true,
            isFrozen: false,
            borrowingEnabled: true,
            supplyCap: 100000000n,
            borrowCap: 100000000n,
        };
        reserveConfiguration1 = {
            $$type: 'ReserveConfiguration',
            ...commonReserveConfiguration,
            poolWalletAddress: poolWalletAddress1,
            aTokenAddress: aTokenAddress1,
            dTokenAddress: dTokenAddress1,
            treasury: treasury.address,
            decimals: 9n,
        };

        const mintTestJetton = async (jetton: SandboxContract<SampleJetton>, receiver: Address, amount: bigint) => {
            await jetton.send(
                deployer.getSender(),
                {
                    value: toNano('0.05'),
                },
                {
                    $$type: 'Mint',
                    queryId: 0n,
                    amount,
                    receiver,
                },
            );
        };

        await mintTestJetton(sampleJetton1, deployer.getSender().address, toNano(5000000n));
        await mintTestJetton(sampleJetton1, secondUser.address, toNano(5000000n));
    });

    beforeEach(async () => {
        priceAddresses();
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

    const setMockOraclePrice = async (jetton: Address, price: bigint) => {
        const rst = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetMockOraclePrice',
                asset: jetton,
                price: price,
            },
        );
        expect(rst.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        const reserveData = await pool.getReserveData(jetton);
        expect(reserveData.price).toEqual(price);
    };

    const addReserve1 = async (sender: SandboxContract<TreasuryContract>, configuration: ReserveConfiguration) => {
        await pool.send(
            sender.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'AddReserve',
                reserveAddress: sampleJetton1.address,
                reserveConfiguration: configuration,
                contents: contents1,
                reserveInterestRateStrategy,
            },
        );
    };

    const dropReserve = async (sender: SandboxContract<TreasuryContract>, reserveIndex: bigint) => {
        await pool.send(
            sender.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'DropReserve',
                reserveIndex,
            },
        );
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

    describe('AddReserve and ConfigureReserveAsCollateral', () => {
        it('sender has invalid access', async () => {
            await addReserve1(secondUser, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(0n);
        });
        it('invalid reserve params', async () => {
            await addReserve1(deployer, {
                ...reserveConfiguration1,
                liquidationThreshold: reserveConfiguration1.ltv - 1n,
            });
            await addReserve1(deployer, {
                ...reserveConfiguration1,
                liquidationBonus: 9000n,
            });
            await addReserve1(deployer, {
                ...reserveConfiguration1,
                liquidationThreshold: 9600n,
            });
            await addReserve1(deployer, {
                ...reserveConfiguration1,
                liquidationThreshold: 0n,
            });
            expect(await pool.getReservesLength()).toEqual(0n);
        });
        it('ConfigureReserveAsCollateral: invalid reserve params', async () => {
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'ConfigureReserveAsCollateral',
                    reserve: sampleJetton1.address,
                    ltv: 1000n,
                    liquidationThreshold: 900n,
                    liquidationBonus: 10500n,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
            });
        });
        it('add same reserve twice', async () => {
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
        });
    });

    describe('DropReserve', () => {
        it('reserve not added', async () => {
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
            });
        });
        it('reserve still has borrower', async () => {
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
            await setMockOraclePrice(sampleJetton1.address, toNano('1'));

            const userJettonWallet = blockchain.openContract(
                JettonDefaultWallet.fromAddress(await sampleJetton1.getGetWalletAddress(deployer.address)),
            );
            await supplyJetton(userJettonWallet, deployer, pool.address, toNano(1000));
            expect((await pool.getReserveData(sampleJetton1.address)).totalSupply).not.toEqual(0n);

            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.4'),
                },
                {
                    $$type: 'BorrowToken',
                    tokenAddress: sampleJetton1.address,
                    amount: toNano(50n),
                },
            );
            expect((await pool.getReserveData(sampleJetton1.address)).totalBorrow).not.toEqual(0n);

            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
            });
            expect(await pool.getReservesLength()).toEqual(1n);
        });
        it('reserve still has supplier', async () => {
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
            await setMockOraclePrice(sampleJetton1.address, toNano('1'));

            const userJettonWallet = blockchain.openContract(
                JettonDefaultWallet.fromAddress(await sampleJetton1.getGetWalletAddress(deployer.address)),
            );
            await supplyJetton(userJettonWallet, deployer, pool.address, toNano(1000));
            expect((await pool.getReserveData(sampleJetton1.address)).totalSupply).not.toEqual(0n);
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
            });
            expect(await pool.getReservesLength()).toEqual(1n);
        });
        it('sender has invalid access', async () => {
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
            await setMockOraclePrice(sampleJetton1.address, toNano('1'));

            const result = await pool.send(
                secondUser.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: secondUser.address,
                to: pool.address,
                success: false,
            });
            expect(await pool.getReservesLength()).toEqual(1n);
        });
        it('DropReserve successfully', async () => {
            await addReserve1(deployer, reserveConfiguration1);
            expect(await pool.getReservesLength()).toEqual(1n);
            await setMockOraclePrice(sampleJetton1.address, toNano('1'));

            await grantRole(ACL.POOL_ADMIN_ROLE, secondUser.address);

            const result = await pool.send(
                secondUser.getSender(),
                {
                    value: toNano('0.2'),
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                },
            );
            expect(result.transactions).toHaveTransaction({
                from: secondUser.address,
                to: pool.address,
                success: true,
            });
            expect(await pool.getReservesLength()).toEqual(0n);
        });
    });

    it('SetReserveActive', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveActive',
                reserve: sampleJetton1.address,
                active: true,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveActive',
                reserve: sampleJetton1.address,
                active: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.EMERGENCY_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveActive',
                reserve: sampleJetton1.address,
                active: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveActive',
                reserve: sampleJetton1.address,
                active: true,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
    });
    it('SetReserveFreeze', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveFreeze',
                reserve: sampleJetton1.address,
                freeze: true,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).isFrozen).toEqual(true);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveFreeze',
                reserve: sampleJetton1.address,
                freeze: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveFreeze',
                reserve: sampleJetton1.address,
                freeze: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).isFrozen).toEqual(false);
    });
    it('SetReserveBorrowing', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveBorrowing',
                reserve: sampleJetton1.address,
                enabled: true,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).borrowingEnabled).toEqual(true);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveBorrowing',
                reserve: sampleJetton1.address,
                enabled: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveBorrowing',
                reserve: sampleJetton1.address,
                enabled: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).borrowingEnabled).toEqual(false);
    });
    it('SetReserveFactor', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const newReserveFactor = 3000n;
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveFactor',
                reserve: sampleJetton1.address,
                reserveFactor: newReserveFactor,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).reserveFactor).toEqual(newReserveFactor);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveFactor',
                reserve: sampleJetton1.address,
                reserveFactor: newReserveFactor,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveFactor',
                reserve: sampleJetton1.address,
                reserveFactor: newReserveFactor,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).reserveFactor).toEqual(newReserveFactor);
    });
    it('SetSupplyCap', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const newSupplyCap = 300000n;
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetSupplyCap',
                reserve: sampleJetton1.address,
                supplyCap: newSupplyCap,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).supplyCap).toEqual(newSupplyCap);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetSupplyCap',
                reserve: sampleJetton1.address,
                supplyCap: newSupplyCap,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetSupplyCap',
                reserve: sampleJetton1.address,
                supplyCap: newSupplyCap,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).supplyCap).toEqual(newSupplyCap);
    });
    it('SetBorrowCap', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const newBorrowCap = 300000n;
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetBorrowCap',
                reserve: sampleJetton1.address,
                borrowCap: newBorrowCap,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).borrowCap).toEqual(newBorrowCap);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetBorrowCap',
                reserve: sampleJetton1.address,
                borrowCap: newBorrowCap,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetBorrowCap',
                reserve: sampleJetton1.address,
                borrowCap: newBorrowCap,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).borrowCap).toEqual(newBorrowCap);
    });
    it('SetLiquidationProtocolFee', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const newFee = 3000n;
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetLiquidationProtocolFee',
                reserve: sampleJetton1.address,
                fee: newFee,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).liquidationProtocolFee).toEqual(newFee);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetLiquidationProtocolFee',
                reserve: sampleJetton1.address,
                fee: newFee,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: false,
        });
        await grantRole(ACL.RISK_ADMIN_ROLE, secondUser.address);
        result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetLiquidationProtocolFee',
                reserve: sampleJetton1.address,
                fee: newFee,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect((await pool.getReserveConfiguration(sampleJetton1.address)).liquidationProtocolFee).toEqual(newFee);
    });

    it('SetReserveInterestRateStrategy', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const newStrategy = {
            ...reserveInterestRateStrategy,
            slope1: BigInt(0.05 * 10 ** 27),
        };
        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'SetReserveInterestRateStrategy',
                reserve: sampleJetton1.address,
                strategy: newStrategy,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect(await pool.getReserveInterestRateStrategy(sampleJetton1.address)).toMatchObject(newStrategy);
    });
    it('PausePool', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);

        await grantRole(ACL.EMERGENCY_ADMIN_ROLE, secondUser.address);

        let result = await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'PausePool',
                paused: true,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: secondUser.address,
            to: pool.address,
            success: true,
        });
        expect(((await pool.getReserveConfiguration(sampleJetton1.address)).isActive = false));

        result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'PausePool',
                paused: false,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect(((await pool.getReserveConfiguration(sampleJetton1.address)).isActive = true));
    });
    it('UpdateXTokenContent', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const aToken = blockchain.openContract(
            AToken.fromAddress((await pool.getReserveConfiguration(sampleJetton1.address)).aTokenAddress),
        );
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'UpdateXTokenContent',
                token: aToken.address,
                content: Cell.EMPTY,
            },
        );
        expect((await aToken.getGetJettonData()).content.toString()).toEqual(Cell.EMPTY.toString());
        const dToken = blockchain.openContract(
            DToken.fromAddress((await pool.getReserveConfiguration(sampleJetton1.address)).dTokenAddress),
        );
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'UpdateXTokenContent',
                token: dToken.address,
                content: Cell.EMPTY,
            },
        );
        expect((await dToken.getGetJettonData()).content.toString()).toEqual(Cell.EMPTY.toString());
    });
    it('StopXToken', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        const aToken = blockchain.openContract(
            AToken.fromAddress((await pool.getReserveConfiguration(sampleJetton1.address)).aTokenAddress),
        );
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'StopXToken',
                token: aToken.address,
                stopped: true,
            },
        );
        expect(await aToken.getStopped()).toEqual(true);
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'StopXToken',
                token: aToken.address,
                stopped: false,
            },
        );
        expect(await aToken.getStopped()).toEqual(false);
        const dToken = blockchain.openContract(
            DToken.fromAddress((await pool.getReserveConfiguration(sampleJetton1.address)).dTokenAddress),
        );
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'StopXToken',
                token: dToken.address,
                stopped: true,
            },
        );
        expect(await dToken.getStopped()).toEqual(true);
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'StopXToken',
                token: dToken.address,
                stopped: false,
            },
        );
        expect(await dToken.getStopped()).toEqual(false);
    });
    it('UpdateOracleProvider', async () => {
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'UpdateOracleProvider',
                oracle: sampleJetton1.address,
            },
        );
        expect(await pool.getOracleProvider()).toEqualAddress(sampleJetton1.address);
        await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'UpdateOracleProvider',
                oracle: pool.address,
            },
        );
        expect(await pool.getOracleProvider()).toEqualAddress(sampleJetton1.address);
        await grantRole(ACL.POOL_ADMIN_ROLE, secondUser.address);
        await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'UpdateOracleProvider',
                oracle: pool.address,
            },
        );
        expect(await pool.getOracleProvider()).toEqualAddress(pool.address);
    });

    it('MintToTreasury', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        await setMockOraclePrice(sampleJetton1.address, toNano('1'));

        const userJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton1.getGetWalletAddress(deployer.address)),
        );
        const secondUserJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton1.getGetWalletAddress(secondUser.address)),
        );
        await supplyJetton(userJettonWallet, deployer, pool.address, toNano(1000000));
        expect((await pool.getReserveData(sampleJetton1.address)).totalSupply).not.toEqual(0n);
        let reserveDataAndConfiguration = await pool.getReserveDataAndConfiguration(sampleJetton1.address);

        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.4'),
            },
            {
                $$type: 'BorrowToken',
                tokenAddress: sampleJetton1.address,
                amount: toNano(100000),
            },
        );
        reserveDataAndConfiguration = await pool.getReserveDataAndConfiguration(sampleJetton1.address);

        expect(reserveDataAndConfiguration.reserveData.totalBorrow).not.toEqual(0n);
        await sleep(5000);
        await supplyJetton(secondUserJettonWallet, secondUser, pool.address, toNano(1000000));
        reserveDataAndConfiguration = await pool.getReserveDataAndConfiguration(sampleJetton1.address);

        await pool.send(
            secondUser.getSender(),
            {
                value: toNano('0.4'),
            },
            {
                $$type: 'BorrowToken',
                tokenAddress: sampleJetton1.address,
                amount: toNano(50000n),
            },
        );
        reserveDataAndConfiguration = await pool.getReserveDataAndConfiguration(sampleJetton1.address);

        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'MintToTreasury',
                reserve: sampleJetton1.address,
            },
        );
        let treasuryUserAccount = blockchain.openContract(
            UserAccount.fromAddress(await pool.getUserAccountAddress(reserveConfiguration1.treasury)),
        );
        const reserveDataAndConfigurationAfter = await pool.getReserveDataAndConfiguration(sampleJetton1.address);
        const aToken = blockchain.openContract(
            AToken.fromAddress(reserveDataAndConfigurationAfter.reserveConfiguration.aTokenAddress),
        );
        const treasuryATokenWallet = blockchain.openContract(
            ATokenDefaultWallet.fromAddress(await aToken.getGetWalletAddress(treasury.address)),
        );

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: treasuryUserAccount.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: treasuryUserAccount.address,
            to: pool.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: aToken.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: aToken.address,
            to: treasuryATokenWallet.address,
            success: true,
        });
        expect(reserveDataAndConfigurationAfter.reserveData.accruedToTreasury).toEqual(0n);
        expect(reserveDataAndConfigurationAfter.reserveData.totalSupply).toEqual(
            reserveDataAndConfiguration.reserveData.accruedToTreasury +
                reserveDataAndConfiguration.reserveData.totalSupply,
        );
        expect((await treasuryUserAccount.getAccount()).positionsDetail.get(sampleJetton1.address)?.supply).toEqual(
            reserveDataAndConfiguration.reserveData.accruedToTreasury,
        );
        expect((await treasuryATokenWallet.getGetWalletData()).balance).toEqual(
            reserveDataAndConfiguration.reserveData.accruedToTreasury,
        );

        result = await pool.send(
            treasury.getSender(),
            {
                value: toNano('0.25'),
            },
            {
                $$type: 'WithdrawToken',
                tokenAddress: sampleJetton1.address,
                amount: UINT256_MAX,
            },
        );
        expect(result.transactions).toHaveTransaction({
            from: treasury.address,
            to: pool.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: treasuryUserAccount.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: treasuryUserAccount.address,
            to: pool.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: treasuryUserAccount.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: treasuryUserAccount.address,
            to: pool.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: pool.address,
            to: treasuryATokenWallet.address,
            success: true,
        });
        expect(result.transactions).toHaveTransaction({
            from: treasuryATokenWallet.address,
            to: aToken.address,
            success: true,
        });
        expect(
            Number((await treasuryUserAccount.getAccount()).positionsDetail.get(sampleJetton1.address)?.supply),
        ).toBeCloseTo(0, -1);
        expect(Number((await treasuryATokenWallet.getGetWalletData()).balance)).toBeCloseTo(0, -1);
    });

    it('Rescue token that Pool configured', async () => {
        await addReserve1(deployer, reserveConfiguration1);
        expect(await pool.getReservesLength()).toEqual(1n);
        await setMockOraclePrice(sampleJetton1.address, toNano('1'));

        const userJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton1.getGetWalletAddress(deployer.address)),
        );
        await supplyJetton(userJettonWallet, deployer, pool.address, toNano(1000000));

        let result = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'RescueToken',
                wallet: addresses.poolWalletAddress1,
                amount: toNano(100),
                to: secondUser.address,
            },
        );

        expect(result.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            success: false,
            exitCode: 30492,
        });
    });

    it('Rescue token that Pool is not configured', async () => {
        // deploy test jetton
        const jettonParams = {
            name: 'SampleJetton for Rescue token',
            description: 'Sample Jetton for testing purposes',
            decimals: '9',
            image: 'https://ipfs.io/ipfs/bafybeicn7i3soqdgr7dwnrwytgq4zxy7a5jpkizrvhm5mv6bgjd32wm3q4/welcome-to-IPFS.jpg',
            symbol: 'SAM',
        };
        const sampleJetton2 = await deployJetton(blockchain, deployer, jettonParams);
        await mintJetton(sampleJetton2, deployer.getSender(), deployer.address, toNano(100000n));

        const poolWalletAddress = await sampleJetton2.getGetWalletAddress(pool.address);
        const userJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton2.getGetWalletAddress(deployer.address)),
        );
        const secondUserJettonWallet = blockchain.openContract(
            JettonDefaultWallet.fromAddress(await sampleJetton2.getGetWalletAddress(secondUser.address)),
        );
        const poolJettonWallet = blockchain.openContract(JettonDefaultWallet.fromAddress(poolWalletAddress));

        const amount = toNano(100);

        await userJettonWallet.send(
            deployer.getSender(),
            {
                value: toNano('0.1'),
            },
            {
                $$type: 'TokenTransfer',
                queryId: 0n,
                destination: pool.address,
                amount,
                response_destination: deployer.address,
                custom_payload: null,
                forward_payload: Cell.EMPTY,
                forward_ton_amount: 0n,
            },
        );
        expect((await poolJettonWallet.getGetWalletData()).balance).toEqual(amount);
        const rescueAmount = toNano(100);
        await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.2'),
            },
            {
                $$type: 'RescueToken',
                wallet: poolWalletAddress,
                amount: rescueAmount,
                to: secondUser.address,
            },
        );

        expect((await poolJettonWallet.getGetWalletData()).balance).toEqual(amount - rescueAmount);
        expect((await secondUserJettonWallet.getGetWalletData()).balance).toEqual(rescueAmount);
    });
});
