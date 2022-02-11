import execa from 'execa';
import logger, { Logger } from '@wdio/logger';

export interface ServiceOptions {
    skipAutoPullImage?: boolean;
    selenoidContainerName?: string;
    selenoidUiContainerName?: string;
    selenoidUiVersion?: string;
    port?: number;
    selenoidPort?: number;
    dockerArgs?: string[];
    selenoidUiArgs?: string[];
}

export default class SelenoidStandaloneUiService {
    private options: ServiceOptions;
    private log: Logger;

    constructor(serviceOptions: ServiceOptions) {
        this.options = {
            skipAutoPullImage: false,
            selenoidContainerName: 'wdio_selenoid',
            selenoidUiContainerName: 'wdio_selenoidui',
            selenoidUiVersion: 'latest-release',
            port: 8080,
            selenoidPort: 4444,
            ...serviceOptions,
        };

        this.log = logger('wdio-selenoid-standalone-ui-service');
    }

    async stopSelenoidUi(): Promise<string> {
        this.log.info('Stopping any running selenoid-ui containers');
        try {
            const { stdout } = await execa('docker', ['rm', '-f', this.options.selenoidUiContainerName as string]);

            return Promise.resolve(stdout);
        } catch (error) {
            return Promise.resolve(error);
        }
    }

    async startSelenoidUi(): Promise<string> {
        this.log.info('Starting Selenoid-Ui Container');
        const dockerArgs = this.options.dockerArgs || [];
        const selenoidUiArgs = this.options.selenoidUiArgs || [];

        const startArgs = [
            'run',
            '-d',
            '--name',
            this.options.selenoidUiContainerName as string,
            '-p',
            `${this.options.port}:8080`,
            '--link',
            this.options.selenoidContainerName as string,
            ...dockerArgs,
            `aerokube/selenoid-ui:${this.options.selenoidUiVersion}`,
            '--selenoid-uri',
            `http://${this.options.selenoidContainerName}:${this.options.selenoidPort}`,
            ...selenoidUiArgs,
        ];

        try {
            const { stdout } = await execa('docker', startArgs);

            return Promise.resolve(stdout);
        } catch (error) {
            return Promise.resolve(error);
        }
    }

    async doesImageExist(imageName: string): Promise<boolean> {
        try {
            this.log.debug(`Checking image ${imageName} exists`);
            const { stdout } = await execa('docker', ['image', 'ls', '-f', `reference=${imageName}`]);
            const results = stdout.split('\n');
            return Promise.resolve(results.length >= 2);
        } catch (error) {
            this.log.error(error);
            return Promise.resolve(true);
        }
    }

    async pullRequiredSelenoidUiVersion(): Promise<void> {
        const image = `aerokube/selenoid-ui:${this.options.selenoidUiVersion as string}`;

        if (await this.doesImageExist(image)) {
            this.log.info(`Skipping pull.  Image ${image} already exists`);
        } else {
            try {
                this.log.info(`Pulling selenoid image 'aerokube/selenoid-ui:${this.options.selenoidUiVersion}'`);
                await execa('docker', ['pull', `aerokube/selenoid-ui:${this.options.selenoidUiVersion}`]);
            } catch (error) {
                this.log.error(error);
            }
        }

        return Promise.resolve();
    }

    async sleep(timeout: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, timeout));
    }

    async waitForSelenoidToBeRunning(): Promise<void> {
        this.log.info(`Waiting for Selenoid to be Running`);
        for (let i = 0; i < 10; i += 1) {
            try {
                const { stdout } = await execa('docker', ['ps', '-f', `name=${this.options.selenoidContainerName}`]);
                const results = stdout.split('\n');
                if (results.length >= 2) {
                    return Promise.resolve();
                }
            } catch (error) {
                this.log.debug('Error when checking for Selenoid container: ', error);
            }

            this.log.debug('Selenoid container not started, waiting 1s');
            await this.sleep(1000);
        }

        return Promise.resolve();
    }

    async onPrepare(_config: unknown, _capabilities: unknown): Promise<string> {
        // kill existing selenoid if running
        await this.stopSelenoidUi();

        if (!this.options.skipAutoPullImage) {
            // pull selenoid-ui if needed
            await this.pullRequiredSelenoidUiVersion();
        }

        // wait for selenoid container to be running before we start

        await this.waitForSelenoidToBeRunning();

        // run container
        return this.startSelenoidUi();
    }

    async onComplete(_exitCode: number, _config: unknown, _capabilities: unknown): Promise<string> {
        return this.stopSelenoidUi();
    }
}
