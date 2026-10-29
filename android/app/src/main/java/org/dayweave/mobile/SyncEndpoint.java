package org.dayweave.mobile;

import java.net.URI;
import java.util.Locale;
import java.util.ArrayList;
import java.util.List;

final class SyncEndpoint {
    interface Attempt<T> {
        T run(String endpoint) throws Exception;
    }
    static List<String> parseList(String legacy, List<String> configured) throws Exception {
        List<String> values = configured == null ? java.util.Collections.singletonList(legacy) : configured;
        if (values.isEmpty() || values.size() > 16) throw new IllegalArgumentException("Provide 1-16 sync addresses");
        List<String> endpoints = new ArrayList<>();
        for (String value : values) {
            String endpoint = parse(value);
            if (!endpoints.contains(endpoint)) endpoints.add(endpoint);
        }
        return endpoints;
    }
    static <T> T first(List<String> endpoints, Attempt<T> attempt) throws Exception {
        Exception failure = null;
        for (String endpoint : endpoints) {
            try { return attempt.run(endpoint); }
            catch (Exception error) { failure = error; }
        }
        if (failure != null) throw failure;
        throw new IllegalArgumentException("No sync addresses");
    }
    static String parse(String value) throws Exception {
        URI uri = new URI(value);
        String host = uri.getHost();
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (host == null || uri.getUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null || uri.getPort() > 65535)
            throw new IllegalArgumentException("Invalid sync address");
        String path = uri.getRawPath();
        if ("https".equals(scheme)) {
            if (!path.isEmpty() && !path.matches("/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*"))
                throw new IllegalArgumentException("Invalid sync path");
            if (path.endsWith("/")) path = path.substring(0, path.length() - 1);
            return "https://" + host.toLowerCase(Locale.ROOT) + (uri.getPort() < 0 || uri.getPort() == 443 ? "" : ":" + uri.getPort()) + path;
        }
        if (!"http".equals(scheme) || !host.matches("[0-9]+\\.[0-9]+\\.[0-9]+\\.[0-9]+") || !(path.isEmpty() || "/".equals(path)))
            throw new IllegalArgumentException("Use HTTPS or a local HTTP address");
        String[] parts = host.split("\\.");
        int[] octets = new int[4];
        for (int index = 0; index < 4; index++) {
            octets[index] = Integer.parseInt(parts[index]);
            if (octets[index] > 255) throw new IllegalArgumentException("Invalid IP");
        }
        if (!(octets[0] == 10 || octets[0] == 127 || octets[0] == 192 && octets[1] == 168 || octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] == 100 && octets[1] >= 64 && octets[1] <= 127 || octets[0] == 169 && octets[1] == 254))
            throw new IllegalArgumentException("Public HTTP is not allowed");
        return "http://" + host + (uri.getPort() < 0 || uri.getPort() == 80 ? "" : ":" + uri.getPort());
    }
}
