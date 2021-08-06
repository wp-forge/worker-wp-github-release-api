# WordPress GitHub Release API

A Cloudflare Worker that provides a REST API for WordPress plugin and theme data. Most commonly, this API is used to manage custom plugin and theme updates in WordPress.

All data is fetched from GitHub directly and makes a few assumptions:

- Your WordPress plugin or theme lives in a public or private GitHub repository.
- You've created at least one [release](https://docs.github.com/en/github/administering-a-repository/releasing-projects-on-github/managing-releases-in-a-repository#creating-a-release) on GitHub.
- Your releases contain a `.zip` artifact that is used for the plugin or theme installation.

## Prerequisites

- Sign up for a [Cloudflare Workers account](https://dash.cloudflare.com/sign-up/workers).
- Install [Node and NPM](https://nodejs.org/en/download/).
- Install the [Wrangler CLI](https://developers.cloudflare.com/workers/cli-wrangler/install-update) by running `npm 
  i -g @cloudflare/wrangler`.
- Run `wrangler login` to link the Wrangler CLI to your Cloudflare account.

## Installation

- Run `git clone git@github.com:wp-forge/worker-wp-github-release-api.git` to clone the repository.
- Run `cp wrangler.example.toml wrangler.toml` to create your own `wrangler.toml` file.
- Run `wrangler whoami` to get your Cloudflare Account ID.
- Set your Cloudflare Account ID as `account_id` in the `wrangler.toml` file.
- Set your GitHub username as `GITHUB_USER` in the `wrangler.toml` file.
- Run `wrangler publish` to deploy the Worker to Cloudflare.
- Create a [personal access token](https://github.com/settings/tokens) on GitHub (don't set an expiration and only
  check the `repo` permissions).
- Run `wrangler secret put GITHUB_TOKEN` to set your GitHub token as an environmental secret on Cloudflare.

## Usage

Once installed, you should be able to access the API at `https://wp-github-release-api.<your-subdomain>.workers.dev`.

If you prefer to have the API live on a custom domain, follow the steps on setting up a [custom route](https://developers.cloudflare.com/workers/platform/routes) for your 
Cloudflare Worker.

There are two required URL parameters for the API to work:

- **vendor** - This is the GitHub username or organization name where the repository is located.
- **package** - This is the slug of the GitHub repository name.

There is one optional URL parameter:

- **basename** - This is the WordPress plugin basename OR the path to the `style.css` file of a theme relative to 
  the `wp-content/themes/` directory.

_All examples below will ONLY show the query string for the request and are NOT URI encoded for readability purposes. 
As a best practice, you should URI encode your query parameter values. For the examples below, this means simply 
replacing the `/` character with `%2F`._

### Plugin Request

#### Request
```text
?vendor=wpscholar-wp-plugins&package=shortcode-scrubber
```

In this scenario, the plugin basename is assumed to be `shortcode-scrubber/shortcode-scrubber.php`. 

If the `basename` can't be derived from the `package` (i.e. `<package>/<package>.php`), then you must provide 
`basename` 
as a parameter:

```text
?vendor=wpscholar-wp-plugins&package=shortcode-scrubber&basename=shortcode-scrubber/scrubber.php
```

#### Response
```json
{
  "name": "Shortcode Scrubber",
  "type": "plugin",
  "version": "1.0.3",
  "description": "A powerful tool for cleaning up shortcodes on your site and confidently managing plugins and themes that use shortcodes.",
  "author": {
    "name": "Micah Wood",
    "url": "https://wpscholar.com"
  },
  "updated": "2020-05-11T22:23:45Z",
  "slug": "shortcode-scrubber",
  "basename": "shortcode-scrubber/shortcode-scrubber.php",
  "url": "https://wpscholar.com/wordpress-plugins/shortcode-scrubber/",
  "download": "https://github.com/wpscholar-wp-plugins/shortcode-scrubber/releases/download/1.0.3/shortcode-scrubber.zip",
  "requires": {
    "wp": "3.2",
    "php": "5.6"
  },
  "tested": {
    "wp": ""
  }
}
```

### Theme Request

#### Request
```text
?vendor=wpscholar&package=block-theme&basename=block-theme/style.css
```

#### Response
```json
{
  "name": "Block Theme",
  "type": "theme",
  "version": "1.0",
  "description": "A block theme experiment",
  "author": {
    "name": "Micah Wood",
    "url": "https://wpscholar.com"
  },
  "updated": "2021-08-06T13:27:23Z",
  "slug": "block-theme",
  "url": "",
  "download": "https://github.com/wpscholar/block-theme/releases/download/1.0/block-theme.zip",
  "requires": {
    "wp": "",
    "php": ""
  },
  "tested": {
    "wp": ""
  }
}
```

## How to Setup Automated Deployments *(only required if editing code)*

- Install the [GitHub CLI](https://github.com/cli/cli#installation). Mac users can simply run `brew install gh` if
  [Homebrew](https://brew.sh/) is installed.
- [Fork](https://docs.github.com/en/get-started/quickstart/fork-a-repo) this repository into your own GitHub account.
- Clone your new repository onto your local machine.
- Run `npm install` from the project root to install dependencies.
- Create a [Global API Key](https://dash.cloudflare.com/profile/api-tokens) on Cloudflare.
- Run `gh secret set CLOUDFLARE_API_KEY` to set your Cloudflare API key as a secret on GitHub.
- Run `wrangler whoami` to get your Cloudflare Account ID.
- Run `gh secret set CLOUDFLARE_ACCOUNT_ID` to set your Cloudflare Account ID as a secret on GitHub.
- Run `gh secret set GH_USER` to set your GitHub user as a secret on GitHub.
- Run `wrangler publish` to deploy the Worker to Cloudflare. This must be done once initially so that the secret we 
  set next has an existing Worker to be applied to.
- Create a [personal access token](https://github.com/settings/tokens) on GitHub (don't set an expiration and only 
  check the `repo` permissions).
- Run `wrangler secret put GITHUB_TOKEN` to set your GitHub token as an environmental secret on Cloudflare.

Any push to the `master` branch on your GitHub repo will trigger the `.github/workflows/deploy-cloudflare-worker.yml` 
workflow via GitHub Actions and deploy your Worker to Cloudflare automatically. If you use a different default branch, 
such as `main`, simply update the `deploy-cloudflare-worker.yml` file to reflect the correct branch name.
