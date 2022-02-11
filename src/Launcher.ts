import execa from 'execa';
import fs from 'fs-extra';
import * as path from 'path';
import logger, { Logger } from '@wdio/logger';
import { SevereServiceError } from 'webdriverio';

export interface ServiceOptions {
    pathToBrowsersConfig?: string;
    terminateWdioOnError?: boolean;
    selenoidVersion?: string;
    skipAutoPullImage?: boolean;
    selenoidContainerName?: string;
    selenoidUiContainerName?: string;
    selenoidUiVersion?: string;
    port?: number;
    selenoidPort?: number;
    dockerArgs?: string[];
    selenoidUiArgs?: string[];
    selenoidArgs?: string[];
    skipAutoPullImages?: boolean;
}

export interface BrowserConfig {
    [browser: string]: {
        default: string;
        versions: {
            [version: string]: {
                image: string;
                port: number;
                path: string;
            };
        };
    };
}


export default class SelenoidStandaloneService {
    private options: ServiceOptions;
    private log: Logger;
    private dockerSocketPath: string;
    private selenoidBrowsersConfigPath: string;

    constructor(serviceOptions: ServiceOptions) {
        this.options = {
            pathToBrowsersConfig: './browsers.json',
            skipAutoPullImage: false,
            selenoidContainerName: 'wdio_selenoid',
            terminateWdioOnError: true,
            selenoidVersion: 'latest-release',
            selenoidUiContainerName: 'wdio_selenoidui',
            selenoidUiVersion: 'latest-release',
            port: 8080,
            selenoidPort: 4444,
            ...serviceOptions,
        };

        this.log = logger('wdio-selenoid-service');

        const platform = process.platform;
        if (platform === 'win32') {
            this.dockerSocketPath = '//var/run/docker.sock';
            const rawBrowserPath = path.join(process.cwd(), this.options.pathToBrowsersConfig as string);
            this.selenoidBrowsersConfigPath = rawBrowserPath.replace('C', 'c').replace(/\\/g, '/');
        } else {
            this.dockerSocketPath = '/var/run/docker.sock';
            this.selenoidBrowsersConfigPath = path.join(process.cwd(), this.options.pathToBrowsersConfig as string);
        }
    }

    async stopSelenoid(): Promise<string> {
        this.log.info('Stopping any running selenoid containers');
        try {
            // @ts-ignore
            const { stdout } = await execa('docker', ['rm', '-f', this.options.selenoidContainerName as string]);

            return Promise.resolve(stdout);
        } catch (error) {
            return Promise.resolve(error);
        }
    }


    async startSelenoid(): Promise<string> {
        this.log.info('Starting Selenoid Container');
        const dockerArgs = this.options.dockerArgs || [];
        const selenoidArgs = this.options.selenoidArgs || [];

        const startArgs = [
            'run',
            '-d',
            '--name',
            this.options.selenoidContainerName as string,
            '-p',
            '4444:4444',
            '-v',
            `${this.dockerSocketPath}:/var/run/docker.sock`,
            '-v',
            `${path.dirname(this.selenoidBrowsersConfigPath)}/:/etc/selenoid/:ro`,
            ...dockerArgs,
            `aerokube/selenoid:${this.options.selenoidVersion}`,
            ...selenoidArgs,
        ];

        try {
            // @ts-ignore
            const { stdout } = await execa('docker', startArgs);

            return Promise.resolve(stdout);
        } catch (error) {
            if (this.options.terminateWdioOnError === true) {
                throw new SevereServiceError(`Unable to start selenoid container \n${error}`);
            }

            return Promise.resolve(error);
        }
    }

    async verifySelenoidBrowserConfig(): Promise<void> {
        const filePath = await fs.pathExists(this.selenoidBrowsersConfigPath);
        if (!filePath) {
            this.log.error(`Unable to find browsers.json at ${this.selenoidBrowsersConfigPath}`);

            if (this.options.terminateWdioOnError === true) {
                throw new SevereServiceError(`Unable to find browsers.json at ${this.selenoidBrowsersConfigPath}`);
            }
        }

        return Promise.resolve();
    }

    async pullRequiredBrowserFiles(): Promise<void> {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const selenoidConfig: BrowserConfig = require(this.selenoidBrowsersConfigPath);

            const browserImages: string[] = [];

            Object.entries(selenoidConfig).forEach(([_browserName, browserConfig]) => {
                Object.entries(browserConfig.versions).forEach(([_version, versionConfig]) => {
                    browserImages.push(versionConfig.image);
                });
            });

            for (const image of browserImages) {
                if (await this.doesImageExist(image)) {
                    this.log.info(`Skipping pull. Image: ${image} already exists`);
                } else {
                    this.log.info(`Pulling image ${image}`);
                    // @ts-ignore
                    await execa('docker', ['pull', image]);
                }
            }
        } catch (error) {
            this.log.error(error);
        }

        return Promise.resolve();
    }

    async pullRequiredSelenoidVersion(): Promise<void> {
        const image = `aerokube/selenoid:${this.options.selenoidVersion as string}`;

        if (await this.doesImageExist(image)) {
            this.log.info(`Skipping pull.  Image ${image} already exists`);
        } else {
            try {
                this.log.info(`Pulling selenoid image 'aerokube/selenoid:${this.options.selenoidVersion}'`);
                // @ts-ignore
                await execa('docker', ['pull', `aerokube/selenoid:${this.options.selenoidVersion}`]);
            } catch (error) {
                this.log.error(error);
            }
        }

        return Promise.resolve();
    }

    async stopSelenoidUi(): Promise<string> {
        this.log.info('Stopping any running selenoid-ui containers');
        try {
            // @ts-ignore
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
            // @ts-ignore
            const { stdout } = await execa('docker', startArgs);

            return Promise.resolve(stdout);
        } catch (error) {
            return Promise.resolve(error);
        }
    }

    async doesImageExist(imageName: string): Promise<boolean> {
        try {
            this.log.debug(`Checking image ${imageName} exists`);
            // @ts-ignore
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
                // @ts-ignore
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
                // @ts-ignore
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
         // kill existing selenoid and UI if running
        await this.stopSelenoid();
        await this.stopSelenoidUi();

        // check browsers file
        await this.verifySelenoidBrowserConfig();

        if (!this.options.skipAutoPullImages) {
            // pull any containers listed in the browsers.json
            await this.pullRequiredBrowserFiles();
            await this.pullRequiredSelenoidUiVersion();

            // pull selenoid if needed
            await this.pullRequiredSelenoidVersion();
        }

        // run container
        return this.startSelenoid();
        //************************************

        // wait for selenoid container to be running before we start

        await this.waitForSelenoidToBeRunning();

        // run container
        return this.startSelenoidUi();
    }

    async onComplete(_exitCode: number, _config: unknown, _capabilities: unknown): Promise<string> {
         return this.stopSelenoid();
        return this.stopSelenoidUi();
    }
}
