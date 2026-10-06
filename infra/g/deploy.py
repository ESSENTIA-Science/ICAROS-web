"""Build input and deploy the already-built OpenNext bundle with GitHub OIDC credentials."""

import argparse
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
BUILD = ROOT / 'apps/web/.open-next'
REGION = os.environ.get('AWS_REGION', 'ap-northeast-2')


def required(name):
    value = os.environ.get(name, '').strip()
    if not value:
        raise RuntimeError(f'{name} is required')
    return value


def aws(*args):
    output = subprocess.check_output(['aws', *args, '--region', REGION, '--output', 'json'])
    return json.loads(output)


def current_parameters(stack):
    response = aws('cloudformation', 'describe-stacks', '--stack-name', stack)
    return {item['ParameterKey']: item['ParameterValue'] for item in response['Stacks'][0]['Parameters']}


def update_stack(stack, current, changes):
    parameters = [
        {'ParameterKey': key, **({'ParameterValue': changes[key]} if key in changes else {'UsePreviousValue': True})}
        for key in current
    ]
    aws('cloudformation', 'update-stack', '--stack-name', stack, '--use-previous-template',
        '--capabilities', 'CAPABILITY_NAMED_IAM', '--parameters', json.dumps(parameters))
    subprocess.run(['aws', 'cloudformation', 'wait', 'stack-update-complete', '--stack-name', stack,
                    '--region', REGION], check=True)


def read_pointer(bucket, folder):
    pointer_file = folder / 'pointer.json'
    aws('s3api', 'get-object', '--bucket', bucket, '--key', 'control/g-pointer.json', str(pointer_file))
    pointer = json.loads(pointer_file.read_text())
    if (not isinstance(pointer.get('version'), int) or pointer['version'] < 1 or
            not re.fullmatch(r'snapshots/[a-zA-Z0-9/_-]+\.json', pointer.get('key', '')) or
            not re.fullmatch(r'[0-9a-f]{64}', pointer.get('sha256', ''))):
        raise RuntimeError('Invalid G pointer')
    return pointer


def prepare():
    bucket = required('ICAROS_G_BUCKET')
    folder = pathlib.Path(required('RUNNER_TEMP')) / 'icaros-snapshot'
    folder.mkdir(parents=True, exist_ok=True)
    pointer = read_pointer(bucket, folder)
    snapshot = folder / 'snapshot.json'
    aws('s3api', 'get-object', '--bucket', bucket, '--key', pointer['key'], str(snapshot))
    if hashlib.sha256(snapshot.read_bytes()).hexdigest() != pointer['sha256']:
        raise RuntimeError('Snapshot SHA-256 mismatch')
    with open(required('GITHUB_ENV'), 'a', encoding='utf8') as output:
        output.write(f'ICAROS_SNAPSHOT={snapshot}\n')
        output.write(f'ICAROS_SNAPSHOT_SHA256={pointer["sha256"]}\n')
    print('Verified current publication snapshot')


def archive(source, target, wrapper=None):
    with tempfile.TemporaryDirectory(prefix='icaros-bundle-') as temp:
        copy = pathlib.Path(temp) / 'function'
        shutil.copytree(source, copy)
        if wrapper:
            (copy / 'index.mjs').rename(copy / 'open-next-entry.mjs')
            shutil.copy2(wrapper, copy / 'index.mjs')
        with zipfile.ZipFile(target, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=7) as result:
            for item in copy.rglob('*'):
                if item.is_symlink():
                    raise RuntimeError('Unexpected symlink in Lambda bundle')
                if item.is_file():
                    result.write(item, item.relative_to(copy).as_posix())
    with zipfile.ZipFile(target) as result:
        if result.testzip() is not None or 'index.mjs' not in result.namelist():
            raise RuntimeError('Invalid Lambda archive')


def smoke():
    for path in ('/', '/member/', '/posts/', '/vehicles/', '/sitemap.xml'):
        for attempt in range(3):
            try:
                request = urllib.request.Request(f'https://icaros.kr{path}', headers={'Cache-Control': 'no-cache'})
                with urllib.request.urlopen(request, timeout=35) as response:
                    if response.status == 200 and response.read(1024):
                        break
            except Exception:
                pass
            if attempt == 2:
                raise RuntimeError(f'Public smoke failed: {path}')
            time.sleep(5)


def publish():
    bucket = required('ICAROS_G_BUCKET')
    stack = required('ICAROS_G_STACK')
    distribution = required('ICAROS_PUBLIC_DISTRIBUTION_ID')
    function = required('ICAROS_WEB_FUNCTION')
    commit = required('GITHUB_SHA')
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise RuntimeError('Invalid source revision')
    if not (BUILD / 'open-next.output.json').is_file():
        raise RuntimeError('OpenNext bundle is incomplete')
    build_id = (BUILD / 'assets/BUILD_ID').read_text().strip()
    if not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', build_id):
        raise RuntimeError('Invalid OpenNext build ID')
    current = current_parameters(stack)
    if current['BucketName'] != bucket:
        raise RuntimeError('Unexpected G deployment bucket')
    previous = {key: current[key] for key in ('ServerCodeKey', 'RevalidationCodeKey', 'BuildId')}
    with tempfile.TemporaryDirectory(prefix='icaros-release-') as temp:
        folder = pathlib.Path(temp)
        server = folder / 'server.zip'
        revalidator = folder / 'revalidator.zip'
        archive(BUILD / 'server-functions/default', server, ROOT / 'infra/g/server-wrapper.mjs')
        archive(BUILD / 'revalidation-function', revalidator)
        keys = {'ServerCodeKey': f'g/code/server/{commit}/{build_id}.zip',
                'RevalidationCodeKey': f'g/code/revalidator/{commit}/{build_id}.zip',
                'BuildId': build_id}
        for name, path in (('ServerCodeKey', server), ('RevalidationCodeKey', revalidator)):
            aws('s3api', 'put-object', '--bucket', bucket, '--key', keys[name], '--body', str(path))
        for source, prefix in ((BUILD / 'assets', '_assets'), (BUILD / 'cache', '_cache')):
            subprocess.run(['aws', 's3', 'sync', str(source), f's3://{bucket}/{prefix}/',
                            '--region', REGION, '--only-show-errors', '--no-progress'], check=True)
        print('Immutable bundles and assets staged')
        update_stack(stack, current, keys)
        try:
            pointer = read_pointer(bucket, folder)
            event = folder / 'preflight.json'
            event.write_text(json.dumps({'kind': 'icaros.g.preflight', 'snapshot': pointer}))
            invoke = aws('lambda', 'invoke', '--function-name', function,
                         '--cli-binary-format', 'raw-in-base64-out', '--payload', f'fileb://{event}',
                         str(folder / 'preflight-result.json'))
            result = json.loads((folder / 'preflight-result.json').read_text())
            if invoke.get('FunctionError') or result.get('ok') is not True:
                raise RuntimeError('G route preflight failed')
            invalidation = aws('cloudfront', 'create-invalidation', '--distribution-id', distribution,
                               '--paths', '/*')['Invalidation']['Id']
            subprocess.run(['aws', 'cloudfront', 'wait', 'invalidation-completed',
                            '--distribution-id', distribution, '--id', invalidation], check=True)
            smoke()
        except Exception:
            update_stack(stack, current_parameters(stack), previous)
            aws('cloudfront', 'create-invalidation', '--distribution-id', distribution, '--paths', '/*')
            raise
    print('Web deployment and public smoke passed')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=('prepare', 'publish'))
    command = parser.parse_args().command
    prepare() if command == 'prepare' else publish()
