import ApiClient from './api-client.mjs';
import discordWebhook from './webhook.mjs';

class GithubClent extends ApiClient {
    constructor(options) {
        super(options);
        this.branches = options.branches ?? ['main'];
        this.repo = options.repo;
        if (!this.repo) {
            throw new Error('repo parameter missing');
        }
        this.headers ??= {};
        if (process.env.GH_API_TOKEN) {
            this.headers['Authorization'] = `Bearer ${process.env.GH_API_TOKEN}`;
        }
    }

    async getApi(options) {
        return this.get({...options, api: true});
    }

    async getApiFolderContents(options) {
        return this.getApi({
            ...options,
            searchParams: {ref: await this.getBranch()},
            pathname: `/contents${options.pathname}`,
        });
    }

    async getBranch() {
        if (this.branch)  {
            return this.branch;
        }
        if (this.branchSetPromise) {
            return this.branchSetPromise;
        }
        this.branchSetPromise = new Promise(async (resolve, reject) => {
            try {
                response = await this.getApi({
                    pathname: '/branches',
                    cachedName: 'gh_branches.json',
                    refresh: true,
                });
                for (const b of this.branches) {    
                    if (response.some(remoteBranch => remoteBranch.name === b)) {
                        this.branch = b;
                        console.log('branch', branch);
                        return resolve(this.branch);
                    } else {
                        await discordWebhook.alert({title: `${this.repo} repo branch not found`, message: b});
                    }
                }
                throw new Error(`Could not find a valid ${this.repo} repo branch`);
            } catch (error) {
                reject(error);
            }
        }).finally(() => {
            branchSetPromise = false;
        });
        return branchSetPromise;
    }

    buildUrl(options) {
        let urlString = `https://api.github.com/repos/${this.repo}`;
        if (!options.api) {
            urlString = `https://github.com/${this.repo}/raw/refs/heads/${await this.getBranch()}`;
        }
        if (options.pathname) {
            urlString += `/${pathname}`;
        }
        const url = new URL(urlString);
        options.searchParams ??= {};
        for (const pName in options.searchParams) {
            url.searchParams.set(pName, options.searchParams[pName]);
        }
        return url;
    }
}