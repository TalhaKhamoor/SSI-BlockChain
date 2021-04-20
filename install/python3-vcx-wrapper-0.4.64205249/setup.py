from setuptools import setup, find_packages
import os

PKG_VERSION = os.environ.get('PACKAGE_VERSION') or '0.4.2'
PKG_NAME = os.environ.get('PACKAGE_NAME') or 'python3-wrapper-vcx'

def get_version():
    try:
        return os.environ['VCX_VERSION']
    except KeyError:
        return '0.2.0'


setup(
    name=PKG_NAME,
    version=get_version(),
    description='Python 3 wrapper for libcxs',
    long_description='None...for now',
    author="Hyperledger Indy Contributors",
    author_email= "hyperledger-indy@lists.hyperledger.org",
    include_package_data=True,
    packages=find_packages(exclude=['demo', 'tests'])
)
