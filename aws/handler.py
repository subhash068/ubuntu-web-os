import os
import json
import configparser

# Attempt to import boto3
try:
    import boto3
    from botocore.exceptions import NoCredentialsError, ClientError
    BOTO3_AVAILABLE = True
except ImportError:
    BOTO3_AVAILABLE = False

def get_aws_paths():
    home = os.path.expanduser('~')
    aws_dir = os.path.join(home, '.aws')
    credentials_path = os.path.join(aws_dir, 'credentials')
    config_path = os.path.join(aws_dir, 'config')
    return aws_dir, credentials_path, config_path

def handle_aws_api(op, args):
    """
    Dispatcher for AWS Console API operations.
    """
    if op == 'aws_get_config':
        return get_aws_config()
    elif op == 'aws_save_config':
        return save_aws_config(args)
    elif op == 'aws_test_connection':
        return test_aws_connection()
    elif op == 'aws_get_resources':
        return get_aws_resources(args)
    elif op == 'aws_failover_db':
        return simulate_failover(args)
    else:
        return {'error': f'Unknown AWS operation: {op}'}

def get_aws_config():
    _, cred_path, conf_path = get_aws_paths()
    config_data = {
        'boto3_installed': BOTO3_AVAILABLE,
        'has_credentials': False,
        'aws_access_key_id': '',
        'aws_default_region': 'us-east-1'
    }
    
    if os.path.exists(cred_path):
        try:
            parser = configparser.ConfigParser()
            parser.read(cred_path)
            if 'default' in parser:
                key = parser['default'].get('aws_access_key_id', '')
                if key:
                    config_data['has_credentials'] = True
                    # Mask the key for display
                    if len(key) > 8:
                        config_data['aws_access_key_id'] = key[:4] + '*' * (len(key) - 8) + key[-4:]
                    else:
                        config_data['aws_access_key_id'] = '****'
        except Exception as e:
            print(f"Error reading AWS credentials: {e}")

    if os.path.exists(conf_path):
        try:
            parser = configparser.ConfigParser()
            parser.read(conf_path)
            if 'default' in parser:
                config_data['aws_default_region'] = parser['default'].get('region', 'us-east-1')
        except Exception as e:
            print(f"Error reading AWS config: {e}")
            
    return config_data

def save_aws_config(args):
    access_key = args.get('aws_access_key_id', '').strip()
    secret_key = args.get('aws_secret_access_key', '').strip()
    region = args.get('aws_default_region', 'us-east-1').strip()
    
    if not access_key or not secret_key or not region:
        return {'success': False, 'error': 'All fields are required.'}
        
    aws_dir, cred_path, conf_path = get_aws_paths()
    
    try:
        if not os.path.exists(aws_dir):
            os.makedirs(aws_dir, mode=0o700)
            
        # Write credentials
        cred_parser = configparser.ConfigParser()
        if os.path.exists(cred_path):
            cred_parser.read(cred_path)
        if 'default' not in cred_parser:
            cred_parser['default'] = {}
        cred_parser['default']['aws_access_key_id'] = access_key
        cred_parser['default']['aws_secret_access_key'] = secret_key
        
        with open(cred_path, 'w') as f:
            cred_parser.write(f)
            
        # Write config
        conf_parser = configparser.ConfigParser()
        if os.path.exists(conf_path):
            conf_parser.read(conf_path)
        if 'default' not in conf_parser:
            conf_parser['default'] = {}
        conf_parser['default']['region'] = region
        
        with open(conf_path, 'w') as f:
            conf_parser.write(f)
            
        return {'success': True}
    except Exception as e:
        return {'success': False, 'error': f'Failed to write config: {str(e)}'}

def test_aws_connection():
    if not BOTO3_AVAILABLE:
        return {'connected': False, 'error': 'boto3 library is not available on Python server'}
        
    try:
        session = boto3.Session()
        sts = session.client('sts')
        identity = sts.get_caller_identity()
        return {
            'connected': True,
            'arn': identity.get('Arn', ''),
            'account': identity.get('Account', ''),
            'userId': identity.get('UserId', '')
        }
    except (NoCredentialsError, ClientError) as e:
        return {'connected': False, 'error': str(e)}
    except Exception as e:
        return {'connected': False, 'error': f'Unexpected connection error: {str(e)}'}

def get_aws_resources(args):
    # Check connection
    conn = test_aws_connection()
    if not conn.get('connected'):
        # Return Mock data if not connected (Demo Mode)
        return get_mock_resources()
        
    region = args.get('region')
    try:
        session = boto3.Session(region_name=region)
        ec2 = session.client('ec2')
        eks = session.client('eks')
        rds = session.client('rds')
        r53 = session.client('route53')
        ecr = session.client('ecr')
        
        # 1. Fetch VPCs & Subnets
        vpcs = ec2.describe_vpcs()
        subnets = ec2.describe_subnets()
        igws = ec2.describe_internet_gateways()
        nats = ec2.describe_nat_gateways()
        
        # 2. Fetch EC2 Instances
        instances = ec2.describe_instances()
        
        # 3. Fetch EKS Clusters
        eks_clusters = []
        try:
            clusters = eks.list_clusters().get('clusters', [])
            for cname in clusters:
                details = eks.describe_cluster(name=cname).get('cluster', {})
                eks_clusters.append({
                    'name': cname,
                    'status': details.get('status'),
                    'version': details.get('version'),
                    'endpoint': details.get('endpoint')
                })
        except Exception as e:
            print(f"Error fetching EKS: {e}")

        # 4. Fetch RDS Databases
        db_clusters = []
        try:
            clusters = rds.describe_db_clusters().get('DBClusters', [])
            for c in clusters:
                db_clusters.append({
                    'id': c.get('DBClusterIdentifier'),
                    'engine': c.get('Engine'),
                    'status': c.get('Status'),
                    'endpoint': c.get('Endpoint'),
                    'members': [{
                        'id': m.get('DBInstanceIdentifier'),
                        'role': 'Primary' if m.get('IsClusterWriter') else 'Reader',
                        'az': m.get('AvailabilityZone')
                    } for m in c.get('DBClusterMembers', [])]
                })
        except Exception as e:
            print(f"Error fetching RDS: {e}")

        # 5. Fetch Route 53
        zones = []
        try:
            hz_list = r53.list_hosted_zones().get('HostedZones', [])
            for z in hz_list:
                z_id = z.get('Id')
                records = r53.list_resource_record_sets(HostedZoneId=z_id).get('ResourceRecordSets', [])
                zones.append({
                    'name': z.get('Name'),
                    'id': z_id,
                    'record_count': z.get('ResourceRecordCount'),
                    'records': [{
                        'name': r.get('Name'),
                        'type': r.get('Type'),
                        'ttl': r.get('TTL'),
                        'value': [val.get('Value') for val in r.get('ResourceRecords', [])] or [r.get('AliasTarget', {}).get('DNSName', 'Alias')]
                    } for r in records]
                })
        except Exception as e:
            print(f"Error fetching Route 53: {e}")

        # 6. Fetch ECR Repositories
        repos = []
        try:
            ecr_list = ecr.describe_repositories().get('repositories', [])
            for rp in ecr_list:
                rname = rp.get('repositoryName')
                imgs = ecr.describe_images(repositoryName=rname).get('imageDetails', [])
                repos.append({
                    'name': rname,
                    'uri': rp.get('repositoryUri'),
                    'images': [{
                        'tag': i.get('imageTags', ['<untagged>'])[0] if i.get('imageTags') else '<untagged>',
                        'digest': i.get('imageDigest')[:12] if i.get('imageDigest') else '',
                        'pushed': str(i.get('imagePushedAt')) if i.get('imagePushedAt') else ''
                    } for i in imgs]
                })
        except Exception as e:
            print(f"Error fetching ECR: {e}")

        return {
            'mode': 'real',
            'identity': conn,
            'region': region or session.region_name,
            'vpc_data': {
                'vpcs': [{'id': v.get('VpcId'), 'cidr': v.get('CidrBlock'), 'is_default': v.get('IsDefault')} for v in vpcs.get('Vpcs', [])],
                'subnets': [{'id': s.get('SubnetId'), 'vpc_id': s.get('VpcId'), 'cidr': s.get('CidrBlock'), 'az': s.get('AvailabilityZone'), 'public': s.get('MapPublicIpOnLaunch', False)} for s in subnets.get('Subnets', [])],
                'nats': [{'id': n.get('NatGatewayId'), 'status': n.get('State'), 'az': n.get('SubnetId')} for n in nats.get('NatGateways', [])]
            },
            'eks_clusters': eks_clusters,
            'db_clusters': db_clusters,
            'dns_zones': zones,
            'ecr_repos': repos
        }
    except Exception as e:
        return {
            'error': f'Failed querying real resources: {str(e)}',
            'fallback_to_demo': True,
            **get_mock_resources()
        }

# Simulated database failover state
_failover_state = {
    'primary_az': 'us-east-1b',
    'last_failover': 0
}

def simulate_failover(args):
    import time
    now = time.time()
    if now - _failover_state['last_failover'] < 5:
        return {'success': False, 'error': 'Failover is already in progress...'}
        
    azs = ['us-east-1a', 'us-east-1b', 'us-east-1c']
    current = _failover_state['primary_az']
    new_az = next(az for az in azs if az != current)
    _failover_state['primary_az'] = new_az
    _failover_state['last_failover'] = now
    
    return {
        'success': True,
        'new_primary_az': new_az,
        'msg': f'Successfully failed over RDS Primary from {current} to {new_az}'
    }

def get_mock_resources():
    primary_az = _failover_state['primary_az']
    
    # Generate database roles depending on current failover state
    db_members = [
        {'id': 'rds-db-replica-1', 'role': 'Primary' if primary_az == 'us-east-1a' else 'Reader', 'az': 'us-east-1a', 'status': 'Active'},
        {'id': 'rds-db-primary', 'role': 'Primary' if primary_az == 'us-east-1b' else 'Reader', 'az': 'us-east-1b', 'status': 'Active'},
        {'id': 'rds-db-replica-2', 'role': 'Primary' if primary_az == 'us-east-1c' else 'Reader', 'az': 'us-east-1c', 'status': 'Active'}
    ]
    
    return {
        'mode': 'demo',
        'region': 'us-east-1',
        'vpc_data': {
            'vpcs': [{'id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.0.0/16', 'is_default': False}],
            'subnets': [
                {'id': 'subnet-public-1a', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.1.0/24', 'az': 'us-east-1a', 'public': True},
                {'id': 'subnet-public-1b', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.2.0/24', 'az': 'us-east-1b', 'public': True},
                {'id': 'subnet-public-1c', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.3.0/24', 'az': 'us-east-1c', 'public': True},
                {'id': 'subnet-private-1a', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.10.0/24', 'az': 'us-east-1a', 'public': False},
                {'id': 'subnet-private-1b', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.20.0/24', 'az': 'us-east-1b', 'public': False},
                {'id': 'subnet-private-1c', 'vpc_id': 'vpc-0a1b2c3d4e5f6g7h8', 'cidr': '10.0.30.0/24', 'az': 'us-east-1c', 'public': False}
            ],
            'nats': [
                {'id': 'nat-0a1b2c3d', 'status': 'Available', 'az': 'us-east-1a'},
                {'id': 'nat-0e5f6g7h', 'status': 'Available', 'az': 'us-east-1b'},
                {'id': 'nat-0i8j9k0l', 'status': 'Available', 'az': 'us-east-1c'}
            ]
        },
        'eks_clusters': [{
            'name': 'eks-production-cluster',
            'status': 'ACTIVE',
            'version': '1.30.0',
            'endpoint': 'https://A1B2C3D4E5F6G7H8.gr7.us-east-1.eks.amazonaws.com'
        }],
        'db_clusters': [{
            'id': 'rds-postgres-prod-cluster',
            'engine': 'aurora-postgresql',
            'status': 'available',
            'endpoint': 'rds-postgres-prod.cluster-ro-xyz.us-east-1.rds.amazonaws.com',
            'members': db_members
        }],
        'dns_zones': [{
            'name': 'webos.dev.',
            'id': '/hostedzone/Z0123456789ABCDEF',
            'record_count': 4,
            'records': [
                {'name': 'webos.dev.', 'type': 'A', 'ttl': 300, 'value': ['34.200.45.12']},
                {'name': 'api.webos.dev.', 'type': 'CNAME', 'ttl': 60, 'value': ['eks-production-elb-123456.us-east-1.elb.amazonaws.com']},
                {'name': 'redis.webos.dev.', 'type': 'A', 'ttl': 300, 'value': ['10.0.10.45']},
                {'name': 'ns.webos.dev.', 'type': 'NS', 'ttl': 172800, 'value': ['ns-2048.awsdns-64.com', 'ns-2049.awsdns-65.net']}
            ]
        }],
        'ecr_repos': [
            {
                'name': 'ubuntu-webos-app',
                'uri': '123456789012.dkr.ecr.us-east-1.amazonaws.com/ubuntu-webos-app',
                'images': [
                    {'tag': 'latest', 'digest': 'sha256:abcd1234efgh5678', 'pushed': '2026-06-16 12:45:00'},
                    {'tag': 'v1.2.0', 'digest': 'sha256:1234567890abcdef', 'pushed': '2026-06-15 08:30:00'},
                    {'tag': 'v1.1.0', 'digest': 'sha256:fedcba0987654321', 'pushed': '2026-06-10 17:15:00'}
                ]
            },
            {
                'name': 'redis-server-service',
                'uri': '123456789012.dkr.ecr.us-east-1.amazonaws.com/redis-server-service',
                'images': [
                    {'tag': 'v7.2-alpine', 'digest': 'sha256:9876543210fedcba', 'pushed': '2026-06-12 14:00:00'}
                ]
            }
        ]
    }
