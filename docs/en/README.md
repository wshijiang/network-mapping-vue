# Network Mapping Web documentation

This is the English entry point for the web component. The first translated pages cover deployment and language support. Advanced topics currently remain in Chinese and are linked explicitly below.

- [Deployment and verification](DEPLOYMENT.md)
- [Language selection and documentation maintenance](LOCALIZATION.md)
- [Complete Chinese documentation](https://github.com/wshijiang/network-mapping-vue/blob/main/docs/README.md)
- [Change log (Chinese)](https://github.com/wshijiang/network-mapping-vue/blob/main/docs/CHANGELOG.md)
- [Source repository](https://github.com/wshijiang/network-mapping-vue)

## Release preparation

This component is preparing **0.1.25**, paired with server **0.1.31**, scanner **0.1.22**, and web console **0.1.25**. Release PRs remain open for review; version tags have not been pushed. The planned 0.1.24 was incremented to 0.1.25 because the v0.1.24 tag from the previous republished release already exists on the remote. The paired server upgrades from 0.1.30 with idempotent incremental migrations; older installations must complete the transport endpoint migration first. See the [release and upgrade procedure (Chinese)](https://github.com/wshijiang/network-mapping/blob/main/docs/RELEASING.md) and the change log above for scope, rollback and tag checks after merging.

## Related components

- [Server documentation](https://github.com/wshijiang/network-mapping/blob/main/docs/README.md)
- [Web console documentation](https://github.com/wshijiang/network-mapping-vue/blob/main/docs/README.md)
- [Scanner documentation](https://github.com/wshijiang/Network-Mapping-Scanner/blob/main/docs/README.md)

The language menu switches to the translated counterpart when one exists. Otherwise it opens that language's documentation home. Translations do not change CLI options, API fields, protocol names or original evidence. Check the complete Chinese reference for features not covered here.
