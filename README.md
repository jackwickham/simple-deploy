# simple-deploy

> A GitHub App built with [Probot](https://github.com/probot/probot) that Create a github deployment and use it to deploy main when new commits are made

## Setup

```sh
# Install dependencies
npm install

# Run the bot
npm start
```

## Docker

```sh
# 1. Build container
docker build -t simple-deploy .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> simple-deploy
```

## Contributing

If you have suggestions for how simple-deploy could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2021 Jack Wickham <jack@jackw.net>
