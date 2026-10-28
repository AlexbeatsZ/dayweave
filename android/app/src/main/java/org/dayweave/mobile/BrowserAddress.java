package org.dayweave.mobile;

import java.net.URI;

final class BrowserAddress {
    static String parse(String text,boolean editable) {
        if(editable||text==null)return null;
        String candidate=text.trim();if(candidate.isEmpty()||candidate.matches(".*\\s.*"))return null;
        try {
            URI uri=new URI(candidate.startsWith("http://")||candidate.startsWith("https://")?candidate:"https://"+candidate);
            String host=uri.getHost();if(host==null||uri.getUserInfo()!=null||(!host.contains(".")&&!host.equals("localhost")))return null;
            if(!"http".equals(uri.getScheme())&&!"https".equals(uri.getScheme()))return null;
            return candidate.replaceFirst("^https?://","");
        } catch(Exception ignored) {return null;}
    }
}
