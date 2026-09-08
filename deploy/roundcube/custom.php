<?php
/**
 * Custom Roundcube Webmail configuration for Toowix Platform.
 * Disables TLS peer verification for local self-signed Stalwart instances.
 */

$config['imap_conn_options'] = [
    'ssl' => [
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'allow_self_signed' => true,
    ],
];

$config['smtp_conn_options'] = [
    'ssl' => [
        'verify_peer'       => false,
        'verify_peer_name'  => false,
        'allow_self_signed' => true,
    ],
];

// Use modern responsive Elastic skin
$config['skin'] = 'elastic';

// Support full email addresses as usernames
$config['login_autocomplete'] = 2;

// Session lifetime in minutes
$config['session_lifetime'] = 1440;
