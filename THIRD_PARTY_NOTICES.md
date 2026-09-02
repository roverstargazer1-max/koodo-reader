# Third-Party Notices

Koodo Reader Personal is distributed under the repository's [GNU Affero General Public License v3.0](./LICENSE). It incorporates or redistributes the following third-party software. Copyright remains with the respective authors.

## Primary Projects

| Component | Use | Version | License | Source |
| --- | --- | --- | --- | --- |
| Koodo Reader | Upstream application and project history | derived from the `dev` branch | AGPL-3.0 | https://github.com/koodo-reader/koodo-reader |
| JMComic-Crawler-Python | Online-comics client dependency | 2.7.5 | MIT | https://github.com/hect0x7/JMComic-Crawler-Python |
| Python | Sidecar interpreter/runtime | 3.12 | PSF License Version 2 | https://www.python.org/ |
| PyInstaller | Windows `onedir` sidecar builder and bootloader | 6.14.1 | GPL-2.0-or-later with the PyInstaller bootloader exception | https://pyinstaller.org/ |

## Locked Sidecar Runtime

The exact versions are defined in [`requirements.lock`](./scripts/jmcomic/requirements.lock) and [`requirements-build.lock`](./scripts/jmcomic/requirements-build.lock).

| Distribution | Version | License |
| --- | --- | --- |
| certifi | 2026.7.22 | MPL-2.0 |
| cffi | 2.1.1 | MIT-0 |
| commonX | 0.6.40 | MIT (the PyPI metadata omits the field; the upstream repository contains the MIT license) |
| curl_cffi | 0.16.2 | MIT |
| Pillow | 12.3.0 | MIT-CMU |
| pycparser | 3.0 | BSD-3-Clause |
| pycryptodome | 3.23.0 | BSD-2-Clause and public-domain components |
| PyYAML | 6.0.3 | MIT |

PyInstaller build-only dependencies are not imported by the application at runtime but are listed in the build lock. Full license texts and package metadata remain in their source distributions and in the collected sidecar where supplied by each package.

This notice is informational and does not replace any component's license text.
