import { Blockchain, SandboxContract, TreasuryContract } from '@ton/sandbox';
import { address, toNano, beginCell, Address } from '@ton/core';
import { Pool, ReserveConfiguration } from '../wrappers/Pool';
import '@ton/test-utils';

describe('Pool', () => {
    let blockchain: Blockchain;
    let deployer: SandboxContract<TreasuryContract>;
    let pool: SandboxContract<Pool>;

    const reserveAddress = address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV');

    const reserveConfiguration : ReserveConfiguration= {
        $$type: 'ReserveConfiguration',
        lTokenAddress: address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV'),
        dTokenAddress: address('UQAEJ7U1iaC1TzcFel5lc2-JaEm8I0k5Krui3fzz3_GeANWV'),
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

    beforeEach(async () => {
        blockchain = await Blockchain.create();

        pool = blockchain.openContract(await Pool.fromInit());

        deployer = await blockchain.treasury('deployer');

        const deployResult = await pool.send(
            deployer.getSender(),
            {
                value: toNano('0.05')
            },
            {
                $$type: 'Deploy',
                queryId: 0n
            }
        );

        expect(deployResult.transactions).toHaveTransaction({
            from: deployer.address,
            to: pool.address,
            deploy: true,
            success: true
        });
    });

    it('should deploy', async () => {
        // the check is done inside beforeEach
        // blockchain and pool are ready to use
    });

    describe('addReserve', () => {
        it('should add reserve successfully', async () => {
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: true
            });

            const reserveLength = await pool.getReservesLength();
            expect(reserveLength).toEqual(1n);

            const reserveAddressResult = await pool.getReserveAddress(0n);
            expect(reserveAddressResult.toString()).toEqual(reserveAddress.toString());

            const reserveData = await pool.getReserveData(reserveAddress);
            expect(reserveData).toMatchObject({
                liquidityIndex: 1n,
                borrowIndex: 1n,
                totalSupply: 0n,
                availableLiquidity: 0n,
                accruedToTreasury: 0n,
                totalBorrow: 0n,
                // ignore lastUpdateTimestamp
            });

            const reserveConfigurationResult = await pool.getReserveConfiguration(reserveAddress);
            const { lTokenAddress, dTokenAddress, ...otherReserveConfiguration } = reserveConfigurationResult;
            expect(reserveConfiguration).toMatchObject(otherReserveConfiguration);
            expect (lTokenAddress.toString()).toEqual(reserveConfiguration.lTokenAddress.toString());
            expect (dTokenAddress.toString()).toEqual(reserveConfiguration.dTokenAddress.toString());
        });

        it('should fail if reserve already exists', async () => {
             await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration
                }
            );

            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: false,
            });
        });

        it('should fail if reserve config is invalid', async () => {
            // TODO
        });

        // Skip owner check
        // Skip stopped check
    });

    describe('dropReserve', () => {
        beforeEach(async () => {
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration
                }
            );
        })

        it('should drop reserve successfully', async () => {
            const result = await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 0n,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: deployer.address,
                to: pool.address,
                success: true,
            });

            const reserveLength = await pool.getReservesLength();
            expect(reserveLength).toEqual(0n);
        })

        it('should fail if reserve index is out of range when drop reserve', async () => {
            const notDeployer = await blockchain.treasury('notDeployer');

            const result = await pool.send(
                notDeployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'DropReserve',
                    reserveIndex: 1n,
                }
            );

            expect(result.transactions).toHaveTransaction({
                from: notDeployer.address,
                to: pool.address,
                success: false,
            });
        });
    });

    describe('getters', () => {
        beforeEach(async () => {
            await pool.send(
                deployer.getSender(),
                {
                    value: toNano('0.05')
                },
                {
                    $$type: 'AddReserve',
                    reserveAddress,
                    reserveConfiguration
                }
            );
        })

        it('should getReserveAddress', async () => {
            const result = await pool.getReserveAddress(0n);
            expect(result.toString()).toEqual(reserveAddress.toString());
        });

        it('should getReserveData', async () => {
            const result = await pool.getReserveData(reserveAddress);
            expect(result).toMatchObject({
                liquidityIndex: 1n,
                borrowIndex: 1n,
                totalSupply: 0n,
                availableLiquidity: 0n,
                accruedToTreasury: 0n,
                totalBorrow: 0n,
                // ignore lastUpdateTimestamp
            });
        });

        it('should getReserveConfiguration', async () => {
            const result = await pool.getReserveConfiguration(reserveAddress);
            const { lTokenAddress, dTokenAddress, ...otherReserveConfiguration } = result;
            expect(reserveConfiguration).toMatchObject(otherReserveConfiguration);
            expect (lTokenAddress.toString()).toEqual(reserveConfiguration.lTokenAddress.toString());
            expect (dTokenAddress.toString()).toEqual(reserveConfiguration.dTokenAddress.toString());
        });

        it('should getReservesLength', async () => {
            const result = await pool.getReservesLength();
            expect(result).toEqual(1n);
        });
    })
});
